import fs from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { parseArgs } from "node:util";
import { Semaphore } from "@core/asyncutil";
import { Logger } from "@logtape/logtape";
import { RequestError } from "octokit";
import unzip from "unzip-stream";
import {
  pagesBuildCheckName,
  artifactName,
  destinationDir,
  rootLogger,
  octokit,
} from "./common.ts";
import {
  DownloadData,
  targetRepos,
  DownloadResult,
  TargetRepoKey,
  Branch,
  PullRequest,
  Source as ArtifactSource,
} from "./constants.ts";

type Args = {
  skipDownload: boolean;
};

async function main() {
  const args = processArgs();
  const { totalSuccessfulDownloads, successfulDownloads, totalTargets } =
    await collectAllArtifacts(args);

  if (totalSuccessfulDownloads === 0) {
    rootLogger.error("No artifacts were collected.");
    process.exit(1);
  }
  await fs.writeFile(
    `${destinationDir}/downloads.json`,
    JSON.stringify(successfulDownloads, null, 2),
  );
  rootLogger.info`Done:`;
  for (const { repoKey, data, numTargets } of Object.values(
    successfulDownloads,
  )) {
    rootLogger.info`${repoKey}: ${data.length} successful downloads / ${numTargets} targets`;
  }
  rootLogger.info`Total: ${totalSuccessfulDownloads} successful downloads / ${totalTargets} targets`;
}

function processArgs(): Args {
  const { values: args } = parseArgs({
    options: {
      skipDownload: {
        type: "boolean",
      },
      help: {
        type: "boolean",
      },
    },
    args: process.argv.slice(2),
  });

  if (args.help) {
    console.log`Usage: collectArtifacts.ts [--skipDownload]`;
    process.exit(0);
  }
  if (args.skipDownload) {
    rootLogger.info("--skipDownload is set, skipping download.");
  }

  return {
    skipDownload: args.skipDownload ?? false,
  };
}

async function collectAllArtifacts(args: Args) {
  const successfulDownloads: Record<string, DownloadResult> = {};

  let totalSuccessfulDownloads = 0;
  let totalTargets = 0;

  for (const [rawRepoKey, repo] of Object.entries(targetRepos)) {
    const repoKey = rawRepoKey as TargetRepoKey;
    rootLogger.info`Collecting artifacts for ${repo.repo}...`;
    const downloads = await collectArtifacts(args, repoKey);

    successfulDownloads[repoKey] = downloads;
    totalSuccessfulDownloads += downloads.data.length;
    totalTargets += downloads.numTargets;
  }
  return { totalSuccessfulDownloads, successfulDownloads, totalTargets };
}

async function collectArtifacts(
  args: Args,
  repoKey: TargetRepoKey,
): Promise<DownloadResult> {
  const [targetRepoOwner, targetRepoName] =
    targetRepos[repoKey].repo.split("/");
  const { filteredBranches, pullRequests } = await fetchTargets(
    targetRepoOwner,
    targetRepoName,
  );

  const downloadTargets = await Promise.all(
    [
      filteredBranches.map(
        (branch) =>
          ({
            type: "branch",
            branch,
          }) as const,
      ),
      pullRequests.map(
        (pullRequest) =>
          ({
            type: "pullRequest",
            pullRequest,
          }) as const,
      ),
    ]
      .flat()
      .map((source) => collectArtifact(args, repoKey, source)),
  );
  const successfulDownloads = downloadTargets.filter(
    (downloadTarget) => downloadTarget != undefined,
  );
  return {
    repoKey,
    data: successfulDownloads,
    numTargets: downloadTargets.length,
  };
}

async function collectArtifact(
  args: Args,
  repoKey: TargetRepoKey,
  source: ArtifactSource,
): Promise<DownloadData | undefined> {
  const [targetRepoOwner, targetRepoName] =
    targetRepos[repoKey].repo.split("/");
  const log = rootLogger.getChild(
    source.type === "branch"
      ? `Branch ${source.branch.name}`
      : `PR #${source.pullRequest.number}`,
  );

  try {
    const jobAndRunId = await getJobAndRunId(
      log,
      source,
      targetRepoOwner,
      targetRepoName,
    );
    if (jobAndRunId == undefined) {
      throw new Error("No job found");
    }

    const { jobId, runId } = jobAndRunId;
    log.info`Job ID: ${jobId}, Run ID: ${runId}`;
    const success = await waitForJobCompletion(
      log,
      jobId,
      targetRepoOwner,
      targetRepoName,
    );

    if (!success) {
      throw new Error(`Job #${jobId} did not complete successfully`);
    }

    const downloadUrl = await fetchArtifactUrl(
      log,
      targetRepoOwner,
      targetRepoName,
      runId,
    );
    if (!downloadUrl) {
      throw new Error(`Failed to fetch artifact URL for run ${runId}`);
    }

    const path = `${repoKey}/${
      source.type === "branch"
        ? `branch-${source.branch.name}`
        : `pr-${source.pullRequest.number}`
    }`;
    if (args.skipDownload) {
      log.info`Download skipped: ${downloadUrl}`;
    } else {
      await extractArtifact(log, downloadUrl, path);
    }
    log.info("Done.");

    return { source, path };
  } catch (e) {
    log.error`Failed to process: ${e}`;
  }
}

async function fetchTargets(
  targetRepoOwner: string,
  targetRepoName: string,
): Promise<{
  filteredBranches: Branch[];
  pullRequests: PullRequest[];
}> {
  const branches = await octokit.paginate(
    "GET /repos/{owner}/{repo}/branches",
    {
      owner: targetRepoOwner,
      repo: targetRepoName,
    },
  );
  const filteredBranches = branches.filter(
    (branch) => branch.name.startsWith("project-") || branch.name === "main",
  );

  const pullRequests = await octokit.paginate(
    "GET /repos/{owner}/{repo}/pulls",
    {
      owner: targetRepoOwner,
      repo: targetRepoName,
      state: "open",
    },
  );

  return { filteredBranches, pullRequests };
}

async function getJobAndRunId(
  log: Logger,
  source: ArtifactSource,
  targetRepoOwner: string,
  targetRepoName: string,
): Promise<{ jobId: number; runId: number } | undefined> {
  log.info("Checking...");
  const {
    data: { check_runs: checkRuns },
  } = await octokit.request(
    "GET /repos/{owner}/{repo}/commits/{ref}/check-runs",
    {
      owner: targetRepoOwner,
      repo: targetRepoName,
      ref:
        source.type === "branch"
          ? source.branch.name
          : source.pullRequest.head.sha,
    },
  );
  const buildPageCheck = checkRuns.find(
    (checkRun) => checkRun.name === pagesBuildCheckName,
  );
  if (!buildPageCheck) {
    log.info("No build check found");
    return;
  }
  if (!buildPageCheck.details_url) {
    throw new Error(
      `Build check "${pagesBuildCheckName}" does not have a details URL.`,
    );
  }
  const runId = buildPageCheck.details_url.match(/(?<=\/runs\/)[0-9]+/)?.[0];
  if (!runId) {
    log.error(
      `Failed to extract check run ID from details URL: ${buildPageCheck.details_url}`,
    );
    return;
  }
  return { jobId: buildPageCheck.id, runId: Number.parseInt(runId) };
}

const jobWaitSemaphore = new Semaphore(5);
async function waitForJobCompletion(
  log: Logger,
  jobId: number,
  targetRepoOwner: string,
  targetRepoName: string,
): Promise<boolean> {
  let success = false;
  let done = false;
  // タイムアウト：5分
  for (let i = 0; i < 20; i++) {
    done = await jobWaitSemaphore.lock(async () => {
      const { data: job } = await octokit.request(
        "GET /repos/{owner}/{repo}/actions/jobs/{job_id}",
        {
          owner: targetRepoOwner,
          repo: targetRepoName,
          job_id: jobId,
        },
      );
      if (job.status === "completed") {
        success = job.conclusion === "success";
        return true;
      }
      log.info`Waiting for job #${jobId} to complete...`;
      await new Promise((resolve) => setTimeout(resolve, 15000));
      return false;
    });
    if (done) {
      break;
    }
  }
  if (!done) {
    log.error`Job #${jobId} did not complete within the timeout period.`;
    return false;
  }
  if (!success) {
    log.error`Job #${jobId} did not complete successfully.`;
    return false;
  } else {
    return true;
  }
}

async function fetchArtifactUrl(
  log: Logger,
  targetRepoOwner: string,
  targetRepoName: string,
  runId: number,
): Promise<string | undefined> {
  const buildPage = await octokit.request(
    "GET /repos/{owner}/{repo}/actions/runs/{run_id}/artifacts",
    {
      owner: targetRepoOwner,
      repo: targetRepoName,
      run_id: runId,
    },
  );
  const artifact = buildPage.data.artifacts.find(
    (artifact) => artifact.name === artifactName,
  );
  if (!artifact) {
    throw new Error(`Artifact "${artifactName}" not found in run ${runId}`);
  }

  const downloadUrl = artifact.archive_download_url;
  if (!downloadUrl) {
    throw new Error(
      `Artifact "${artifactName}" does not have a download URL in run ${runId}`,
    );
  }
  log.info`Fetching artifact URL from ${downloadUrl}`;

  let innerDownloadUrl: string;
  try {
    innerDownloadUrl = await octokit
      .request(
        "GET /repos/{owner}/{repo}/actions/artifacts/{artifact_id}/{archive_format}",
        {
          owner: targetRepoOwner,
          repo: targetRepoName,
          artifact_id: artifact.id,
          archive_format: "zip",
        },
      )
      .then((response) => response.url);
  } catch (e) {
    if (e instanceof RequestError && e.status === 410) {
      log.error("Artifact is expired");
      return;
    }
    throw e;
  }

  return innerDownloadUrl;
}

async function extractArtifact(
  log: Logger,
  downloadUrl: string,
  path: string,
): Promise<void> {
  log.info`Downloading artifact from ${downloadUrl}`;
  const response = await fetch(downloadUrl);
  if (!response.ok) {
    throw new Error(
      `Failed to download artifact: ${response.status} ${response.statusText}`,
    );
  }
  if (!response.body) {
    throw new Error("Response body is empty");
  }
  const destination = `${destinationDir}/${path}`;
  log.info`Extracting artifact to ${destination}`;
  await fs.mkdir(destination, { recursive: true });
  await pipeline(
    Readable.fromWeb(response.body),
    unzip.Extract({
      path: destination,
    }),
  );
}

await main();
