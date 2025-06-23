import fs from "node:fs/promises";
import { Endpoints } from "@octokit/types";
import { RequestError } from "octokit";
import {
  cacheDownloadDir,
  cacheReleaseName,
  cacheRepo,
  createCacheFileName,
  octokit,
  splitRepoName,
  rootLogger,
} from "./common.ts";
import { DownloadData } from "./constants.ts";

const log = rootLogger.getChild("cache");
type Release =
  Endpoints["GET /repos/{owner}/{repo}/releases/{release_id}"]["response"]["data"];

async function main() {
  const release = await createReleaseIfNotExists();
  await uploadArtifacts(release);
}

async function createReleaseIfNotExists() {
  log.info`Checking if release ${cacheReleaseName} exists...`;

  try {
    const release = await octokit.rest.repos.getReleaseByTag({
      ...splitRepoName(cacheRepo),
      tag: cacheReleaseName,
    });
    log.info`Release ${cacheReleaseName} already exists.`;
    return release.data;
  } catch (error) {
    if (error instanceof RequestError && error.status === 404) {
      log.info`Creating release ${cacheReleaseName}...`;
      const release = await octokit.rest.repos.createRelease({
        ...splitRepoName(cacheRepo),
        tag_name: cacheReleaseName,
        name: "Preview Pages Cache",
        body: "preview-pagesのキャッシュを保存するリリース。手動で編集しないでください。",
        prerelease: true,
      });
      log.info`Release ${cacheReleaseName} created.`;
      return release.data;
    } else {
      throw error;
    }
  }
}

async function uploadArtifacts(release: Release) {
  log.info`Uploading artifacts to ${cacheRepo}...`;

  for (const repo of await fs.readdir(cacheDownloadDir)) {
    if (
      await fs
        .stat(`${cacheDownloadDir}/${repo}`)
        .then((stat) => !stat.isDirectory())
    ) {
      continue;
    }
    for (const file of await fs.readdir(`${cacheDownloadDir}/${repo}`)) {
      if (!file.endsWith(".json")) {
        continue;
      }
      const zipPath = `${cacheDownloadDir}/${repo}/${file.replace(
        ".json",
        ".zip",
      )}`;
      const jsonPath = `${cacheDownloadDir}/${repo}/${file}`;

      await uploadArtifact(release, zipPath, jsonPath);
    }
  }
}

async function uploadArtifact(
  release: Release,
  zipPath: string,
  jsonPath: string,
) {
  const downloadData = JSON.parse(
    await fs.readFile(jsonPath, "utf-8"),
  ) as DownloadData;

  const cacheFileName = createCacheFileName(
    downloadData.source,
    downloadData.runId,
  );

  if (release.assets.some((asset) => asset.name === cacheFileName)) {
    log.info`Asset ${cacheFileName} already exists, skipping upload.`;
    return;
  }

  log.info`Uploading ${cacheFileName} from ${zipPath}...`;
  await octokit.rest.repos.uploadReleaseAsset({
    ...splitRepoName(cacheRepo),
    release_id: release.id,
    name: cacheFileName,
    // @ts-expect-error octokitの型定義が間違っている。 https://github.com/octokit/octokit.js/discussions/2087
    data: await fs.readFile(zipPath),
  });
}

await main();
