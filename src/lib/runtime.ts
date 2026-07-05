export function isVercelRuntime(): boolean {
  return process.env.VERCEL === "1";
}

/** KTrade sync (Playwright) runs only on your local machine, not on Vercel. */
export function isLocalCollectorAvailable(): boolean {
  return !isVercelRuntime();
}
