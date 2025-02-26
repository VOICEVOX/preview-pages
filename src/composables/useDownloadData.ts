import { ref } from "vue";
import type { DownloadResult } from "../../scripts/common.ts";

const downloadResultRef = ref<
  { loading: false; result: DownloadResult[] } | { loading: true }
>({ loading: true });

void fetch(
  `${import.meta.env.BASE_URL}/preview/downloads.json`.replace(/\/\//g, "/"),
).then(async (response) => {
  if (!response.ok) {
    throw new Error(`Failed to fetch downloads.json: ${response.statusText}`);
  }
  const downloadData = (await response.json()) as DownloadResult[];
  downloadResultRef.value = { loading: false, result: downloadData };
});

export function useDownloadData() {
  return downloadResultRef;
}
