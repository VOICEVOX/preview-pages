import {
  cacheReleaseName,
  cacheRepo,
  octokit,
  splitRepoName,
  rootLogger,
} from "./common.ts";
import { targetRepos, TargetRepoKey } from "./constants.ts";

const log = rootLogger.getChild("cleanup");

type ParsedAsset = {
  repoKey: TargetRepoKey;
  sourceKey: string;
  runId: number;
  assetId: number;
  assetName: string;
};

const repoKeyPattern = Object.keys(targetRepos).join("|");
const assetPattern = new RegExp(`^(${repoKeyPattern})-(.+)-(\\d+)-v1\\.zip$`);

function parseAssetName(
  name: string,
  assetId: number,
): ParsedAsset | undefined {
  const match = name.match(assetPattern);
  if (!match) return undefined;
  return {
    repoKey: match[1] as TargetRepoKey,
    sourceKey: match[2],
    runId: parseInt(match[3], 10),
    assetId,
    assetName: name,
  };
}

async function main() {
  log.info`Fetching release assets from ${cacheReleaseName}...`;

  const { data: release } = await octokit.rest.repos.getReleaseByTag({
    ...splitRepoName(cacheRepo),
    tag: cacheReleaseName,
  });

  const assets = release.assets;
  log.info`Found ${assets.length} assets.`;

  // Parse all assets
  const parsed: ParsedAsset[] = [];
  for (const asset of assets) {
    const p = parseAssetName(asset.name, asset.id);
    if (p) {
      parsed.push(p);
    } else {
      log.warn`Skipping unrecognized asset: ${asset.name}`;
    }
  }

  // Group by repoKey + sourceKey
  const grouped = new Map<string, ParsedAsset[]>();
  for (const p of parsed) {
    const key = `${p.repoKey}-${p.sourceKey}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(p);
  }

  const toDelete: ParsedAsset[] = [];

  for (const [, assetList] of grouped) {
    const { repoKey, sourceKey } = assetList[0];

    if (sourceKey.startsWith("pr-")) {
      const prNumber = parseInt(sourceKey.slice(3), 10);
      let isClosed = false;
      try {
        const { data: pr } = await octokit.rest.pulls.get({
          ...splitRepoName(repoKey),
          pull_number: prNumber,
        });
        isClosed = pr.state === "closed";
      } catch {
        log.warn`Failed to fetch PR #${prNumber} for ${repoKey}, skipping.`;
        continue;
      }

      if (isClosed) {
        log.info`PR #${prNumber} (${repoKey}) is closed. Marking all ${assetList.length} asset(s) for deletion.`;
        toDelete.push(...assetList);
      } else {
        // Keep only the latest runId
        const sorted = [...assetList].sort((a, b) => b.runId - a.runId);
        if (sorted.length > 1) {
          log.info`PR #${prNumber} (${repoKey}) has ${sorted.length - 1} old asset(s). Marking for deletion.`;
          toDelete.push(...sorted.slice(1));
        }
      }
    } else {
      // Branch: keep only the latest runId
      const sorted = [...assetList].sort((a, b) => b.runId - a.runId);
      if (sorted.length > 1) {
        log.info`Branch ${sourceKey} (${repoKey}) has ${sorted.length - 1} old asset(s). Marking for deletion.`;
        toDelete.push(...sorted.slice(1));
      }
    }
  }

  if (toDelete.length === 0) {
    log.info`No assets to delete.`;
    return;
  }

  log.info`Deleting ${toDelete.length} asset(s)...`;
  for (const asset of toDelete) {
    log.info`Deleting ${asset.assetName}...`;
    await octokit.rest.repos.deleteReleaseAsset({
      ...splitRepoName(cacheRepo),
      asset_id: asset.assetId,
    });
  }
  log.info`Done. Deleted ${toDelete.length} asset(s).`;
}

await main();
