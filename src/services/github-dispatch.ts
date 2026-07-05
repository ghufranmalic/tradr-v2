import { env, hasGithubDispatchConfig } from "@/src/config/env";

/**
 * Fires the collect workflow on GitHub Actions so a Sync click on Vercel starts
 * the browser-based collector in the cloud within seconds instead of waiting
 * for the next cron tick.
 */
export async function triggerCollectWorkflow(): Promise<{ triggered: boolean; detail: string }> {
  if (!hasGithubDispatchConfig) {
    return {
      triggered: false,
      detail: "GITHUB_REPO / GITHUB_WORKFLOW_TOKEN not configured; the scheduled workflow will pick this sync up."
    };
  }

  const url = `https://api.github.com/repos/${env.GITHUB_REPO}/actions/workflows/${env.GITHUB_COLLECT_WORKFLOW}/dispatches`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.GITHUB_WORKFLOW_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28"
    },
    body: JSON.stringify({ ref: "main" })
  });

  if (response.status === 204) {
    return { triggered: true, detail: "Collector workflow started on GitHub Actions." };
  }

  const body = await response.text().catch(() => "");
  return { triggered: false, detail: `GitHub dispatch failed (${response.status}): ${body.slice(0, 200)}` };
}
