// NOTE: このファイルはフロントエンドからもimportされるため、common.tsのimportは避ける
import { Endpoints } from "@octokit/types";

export type Branch =
  Endpoints["GET /repos/{owner}/{repo}/branches"]["response"]["data"][0];
export type PullRequest =
  Endpoints["GET /repos/{owner}/{repo}/pulls"]["response"]["data"][0];
export type Source =
  | {
      type: "branch";
      branch: Branch;
    }
  | {
      type: "pullRequest";
      pullRequest: PullRequest;
    };
export type DownloadData = {
  source: Source;
  path: string;
  runId: number;
  cached: boolean;
};

export const targetRepos = {
  editor: {
    repo: "VOICEVOX/voicevox",
    label: "エディタ",
    links: [
      {
        path: "editor/index.html",
        buttonType: "success",
        emoji: ":pencil:",
        label: "エディタ",
      },
      {
        path: "storybook/index.html",
        buttonType: "danger",
        emoji: ":book:",
        label: "Storybook",
      },
    ],
  },
  blog: {
    repo: "VOICEVOX/voicevox_blog",
    label: "ホームページ",
    links: [
      {
        path: "index.html",
        buttonType: "success",
        emoji: ":house:",
        label: "ホームページ",
      },
    ],
  },
  docs: {
    repo: "VOICEVOX/WIP_docs",
    label: "ドキュメント",
    links: [
      {
        path: "index.html",
        buttonType: "success",
        emoji: ":green_book:",
        label: "ドキュメント",
      },
    ],
  },
} as const satisfies Record<
  string,
  {
    repo: string;
    label: string;

    links: {
      path: string;
      buttonType: "success" | "danger";
      emoji: string;
      label: string;
    }[];
  }
>;

export type TargetRepoKey = keyof typeof targetRepos;

export type DownloadResult = {
  repoKey: TargetRepoKey;
  data: DownloadData[];
  numTargets: number;
};
