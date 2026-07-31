import { spawnSync } from "node:child_process";

import { getCurrentVersion } from "../version.ts";

const REPO = "anlaki-py/g";
const ASSET_NAME = "git-shortcut-tui.tgz";
const RELEASE_API_URL = `https://api.github.com/repos/${REPO}/releases/latest`;
const RELEASE_DOWNLOAD_URL = `https://github.com/${REPO}/releases/latest/download/${ASSET_NAME}`;

export type UpdateResult =
  | { status: "up-to-date"; version: string }
  | { status: "updated"; from: string; to: string }
  | { status: "cancelled" }
  | { status: "error"; message: string };

export type LatestRelease = { tag: string; url: string };

export type UpdateDeps = {
  currentVersion?: () => string;
  getLatestRelease?: () => Promise<LatestRelease>;
  installFromUrl?: (url: string) => void;
};

export function normalizeVersion(version: string): string {
  return version.replace(/^v/, "");
}

export function compareVersions(a: string, b: string): number {
  const partsA = normalizeVersion(a).split(".").map((part) => Number.parseInt(part, 10) || 0);
  const partsB = normalizeVersion(b).split(".").map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(partsA.length, partsB.length);
  for (let index = 0; index < length; index++) {
    const difference = (partsA[index] ?? 0) - (partsB[index] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
}

export async function getLatestRelease(): Promise<LatestRelease> {
  const response = await fetch(RELEASE_API_URL, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "git-shortcut-tui" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`GitHub API returned ${response.status} ${response.statusText}`);
  }
  const release = (await response.json()) as { tag_name?: string };
  if (!release.tag_name) throw new Error("GitHub API response is missing tag_name");
  return { tag: release.tag_name, url: RELEASE_DOWNLOAD_URL };
}

export function installFromUrl(url: string): void {
  const result = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", ["install", "--global", url], {
    stdio: "inherit",
  });
  if (result.error) {
    const code = (result.error as NodeJS.ErrnoException).code;
    throw new Error(code === "ENOENT" ? "npm is not installed" : result.error.message);
  }
  if (result.status !== 0) {
    throw new Error(`npm install exited with status ${result.status}`);
  }
}

export async function runUpdateWorkflow(dependencies: UpdateDeps = {}): Promise<UpdateResult> {
  const current = dependencies.currentVersion ?? getCurrentVersion;
  const fetchLatest = dependencies.getLatestRelease ?? getLatestRelease;
  const install = dependencies.installFromUrl ?? installFromUrl;

  const from = current();
  let latest: LatestRelease;
  try {
    latest = await fetchLatest();
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : String(error) };
  }

  if (compareVersions(latest.tag, from) <= 0) {
    return { status: "up-to-date", version: from };
  }

  try {
    install(latest.url);
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : String(error) };
  }

  return { status: "updated", from, to: normalizeVersion(latest.tag) };
}
