import { Endpoints } from "@octokit/types";

export type Branch =
  Endpoints["GET /repos/{owner}/{repo}/branches"]["response"]["data"][0];
export type PullRequest =
  Endpoints["GET /repos/{owner}/{repo}/pulls"]["response"]["data"][0];
export type DownloadData = {
  source:
    | {
        type: "branch";
        branch: Branch;
      }
    | {
        type: "pullRequest";
        pullRequest: PullRequest;
      };
  path: string;
};

export const guestRepos = {
  editor: {
    repo: "VOICEVOX/voicevox",
    label: "エディタ",
    links: [
      {
        path: "editor/index.html",
        buttonType: "success",
        label: "エディタ",
      },
      {
        path: "storybook/index.html",
        buttonType: "danger",
        label: "Storybook",
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
      label: string;
    }[];
  }
>;

export type GuestRepoKey = keyof typeof guestRepos;

export type DownloadResult = {
  repoKey: GuestRepoKey;
  data: DownloadData[];
  numTargets: number;
};
