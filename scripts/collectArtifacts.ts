import fs from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { parseArgs } from "node:util";
import { Semaphore } from "@core/asyncutil";
import { RequestError } from "octokit";
import unzip from "unzip-stream";
import {
  pagesBuildCheckName,
  artifactName,
  destinationDir,
  rootLogger,
  octokit,
  DownloadData,
  guestRepos,
  DownloadResult,
} from "./common.ts";

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

const collectArtifacts = async (
  repoKey: keyof typeof guestRepos,
): Promise<DownloadResult> => {
  const [guestRepoOwner, guestRepoName] = guestRepos[repoKey].split("/");
  const branches = await octokit.paginate(
    "GET /repos/{owner}/{repo}/branches",
    {
      owner: guestRepoOwner,
      repo: guestRepoName,
    },
  );
  const filteredBranches = branches.filter(
    (branch) => branch.name.startsWith("project-") || branch.name === "main",
  );

  const semaphore = new Semaphore(5);

  const pullRequests = await octokit.paginate(
    "GET /repos/{owner}/{repo}/pulls",
    {
      owner: guestRepoOwner,
      repo: guestRepoName,
      state: "open",
    },
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
      .map(async (source): Promise<DownloadData | undefined> => {
        const log = rootLogger.getChild(
          source.type === "branch"
            ? `Branch ${source.branch.name}`
            : `PR #${source.pullRequest.number}`,
        );
        try {
          log.info("Checking...");
          const {
            data: { check_runs: checkRuns },
          } = await octokit.request(
            "GET /repos/{owner}/{repo}/commits/{ref}/check-runs",
            {
              owner: guestRepoOwner,
              repo: guestRepoName,
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
            log.info("Build check has no details URL");
            return;
          }
          const runId =
            buildPageCheck.details_url.match(/(?<=\/runs\/)[0-9]+/)?.[0];
          if (!runId) {
            log.error(
              `Failed to extract check run ID from details URL: ${buildPageCheck.details_url}`,
            );
            return;
          }
          const jobId = buildPageCheck.id;
          let success = false;
          let done = false;
          // タイムアウト：5分
          for (let i = 0; i < 20; i++) {
            done = await semaphore.lock(async () => {
              const { data: job } = await octokit.request(
                "GET /repos/{owner}/{repo}/actions/jobs/{job_id}",
                {
                  owner: guestRepoOwner,
                  repo: guestRepoName,
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
            log.error("Job did not complete");
            return;
          }
          if (!success) {
            log.error("Build check did not succeed");
            return;
          }
          const buildPage = await octokit.request(
            "GET /repos/{owner}/{repo}/actions/runs/{run_id}/artifacts",
            {
              owner: guestRepoOwner,
              repo: guestRepoName,
              run_id: Number.parseInt(runId),
            },
          );
          const artifact = buildPage.data.artifacts.find(
            (artifact) => artifact.name === artifactName,
          );
          if (!artifact) {
            log.error("No artifact found");
            return;
          }

          const downloadUrl = artifact.archive_download_url;
          if (!downloadUrl) {
            log.error("No download URL found");
            return;
          }
          log.info`Fetching artifact URL from ${downloadUrl}`;

          let innerDownloadUrl: string;
          try {
            innerDownloadUrl = await octokit
              .request(
                "GET /repos/{owner}/{repo}/actions/artifacts/{artifact_id}/{archive_format}",
                {
                  owner: guestRepoOwner,
                  repo: guestRepoName,
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

          const path = `${repoKey}/${
            source.type === "branch"
              ? `branch-${source.branch.name}`
              : `pr-${source.pullRequest.number}`
          }`;
          if (args.skipDownload) {
            log.info`Download skipped: ${innerDownloadUrl}`;
          } else {
            log.info`Downloading artifact from ${innerDownloadUrl}`;
            const response = await fetch(innerDownloadUrl);
            if (!response.ok) {
              log.error`Failed to download artifact: ${response.statusText}`;
              return;
            }
            if (!response.body) {
              log.error("Response has no body");
              return;
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
          log.info("Done.");

          return { source, dirname: path };
        } catch (e) {
          log.error`Failed to process: ${e}`;
        }
      }),
  );
  const successfulDownloads = downloadTargets.filter(
    (downloadTarget) => downloadTarget !== undefined,
  );
  return {
    repoKey,
    data: successfulDownloads,
    allTargets: downloadTargets.length,
  };
};

const successfulDownloads: DownloadResult[] = [];

let totalSuccessfulDownloads = 0;
let totalTargets = 0;
for (const [rawRepoKey, repo] of Object.entries(guestRepos)) {
  const repoKey = rawRepoKey as keyof typeof guestRepos;
  rootLogger.info`Collecting artifacts for ${repo}...`;
  const downloads = await collectArtifacts(repoKey);
  successfulDownloads.push({
    repoKey: repoKey,
    data: downloads.data,
    allTargets: downloads.allTargets,
  });
  totalSuccessfulDownloads += downloads.data.length;
  totalTargets += downloads.allTargets;
}

if (successfulDownloads.length === 0) {
  rootLogger.error("No artifacts were collected.");
  process.exit(1);
}
await fs.writeFile(
  `${destinationDir}/downloads.json`,
  JSON.stringify(successfulDownloads, null, 2),
);
rootLogger.info`Done:`;
for (const { repoKey, data, allTargets } of successfulDownloads) {
  rootLogger.info`${repoKey}: ${data.length} successful downloads / ${allTargets} targets`;
}
rootLogger.info`Total: ${totalSuccessfulDownloads} successful downloads / ${totalTargets} targets`;
