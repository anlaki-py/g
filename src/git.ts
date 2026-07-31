import { spawnSync, type SpawnSyncOptions } from "node:child_process";

const DEFAULT_MAX_GIT_OUTPUT = 128 * 1024 * 1024;

export type Branch = { name: string; current: boolean };

export type Commit = {
  hash: string;
  shortHash: string;
  author: string;
  date: string;
  subject: string;
};

export type StashEntry = { ref: string; subject: string };

type RunGitOptions = {
  cwd?: string;
  input?: string;
  maxBuffer?: number;
  stdio?: SpawnSyncOptions["stdio"];
  acceptStatuses?: number[];
};

export function getNullDevicePath(platform: NodeJS.Platform = process.platform): string {
  return platform === "win32" ? "NUL" : "/dev/null";
}

function runGit(args: string[], options: RunGitOptions = {}): string {
  const result = spawnSync("git", args, {
    cwd: options.cwd,
    encoding: "utf8",
    input: options.input,
    maxBuffer: options.maxBuffer ?? DEFAULT_MAX_GIT_OUTPUT,
    stdio: options.stdio ?? [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
  });

  if (result.error) {
    const code = (result.error as NodeJS.ErrnoException).code;
    throw new Error(code === "ENOENT" ? "Git is not installed" : result.error.message);
  }
  const acceptedStatuses = options.acceptStatuses ?? [0];
  if (!acceptedStatuses.includes(result.status ?? -1)) {
    const message = result.stderr?.trim() || `Git exited with status ${result.status}`;
    throw new Error(message);
  }

  return result.stdout ?? "";
}

export function parseBranches(output: string): Branch[] {
  return output
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const separator = line.indexOf("\t");
      const marker = separator === -1 ? "" : line.slice(0, separator);
      const name = separator === -1 ? line : line.slice(separator + 1);
      return { name, current: marker === "*" };
    });
}

export function listBranches(cwd: string = process.cwd()): Branch[] {
  const output = runGit(["for-each-ref", "--format=%(HEAD)%09%(refname:short)", "refs/heads"], { cwd });
  return parseBranches(output);
}

export function switchBranch(args: string[], cwd: string = process.cwd()): void {
  runGit(["switch", ...args], { cwd, stdio: "inherit" });
}

export function branchExists(name: string, cwd: string = process.cwd()): boolean {
  const local = spawnSync("git", ["show-ref", "--verify", "--quiet", `refs/heads/${name}`], {
    cwd,
    stdio: "ignore",
  });
  if (local.status === 0) return true;

  const remotes = runGit(["for-each-ref", "--format=%(refname:strip=2)", "refs/remotes"], { cwd })
    .split("\n")
    .filter(Boolean);
  return remotes.some((branch) => branch.endsWith(`/${name}`));
}

export function commit(args: string[], cwd: string = process.cwd()): void {
  runGit(["commit", ...args], { cwd, stdio: "inherit" });
}

export function add(args: string[] = ["."], cwd: string = process.cwd()): void {
  runGit(["add", ...args], { cwd, stdio: "inherit" });
}

export function status(args: string[] = [], cwd: string = process.cwd()): void {
  runGit(["status", ...args], { cwd, stdio: "inherit" });
}

export function init(args: string[] = [], cwd: string = process.cwd()): void {
  runGit(["init", ...args], { cwd, stdio: "inherit" });
}

export function push(args: string[] = [], cwd: string = process.cwd()): void {
  runGit(["push", ...args], { cwd, stdio: "inherit" });
}

export function pull(args: string[] = [], cwd: string = process.cwd()): void {
  runGit(["pull", ...args], { cwd, stdio: "inherit" });
}

export function getCurrentDiff(args: string[] = [], cwd: string = process.cwd()): string {
  const head = spawnSync("git", ["rev-parse", "--verify", "HEAD"], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  const tracked = head.status === 0
    ? runGit(["diff", "HEAD", ...args], { cwd })
    : [
        runGit(["diff", "--cached", ...args], { cwd }),
        runGit(["diff", ...args], { cwd }),
      ].filter(Boolean).join("\n");

  const untrackedFiles = runGit(["ls-files", "--others", "--exclude-standard", "-z"], { cwd })
    .split("\0")
    .filter(Boolean);
  const untracked = untrackedFiles.map((file) => {
    const patch = runGit(["diff", "--no-index", ...args, "--", getNullDevicePath(), file], {
      cwd,
      acceptStatuses: [0, 1],
    });
    if (patch) return patch;
    return `diff --git a/${file} b/${file}\nnew file mode 100644\n--- /dev/null\n+++ b/${file}\n`;
  });

  return [tracked, ...untracked].filter(Boolean).join("\n");
}

export function getDiffBetween(from: string, to: string, args: string[] = [], cwd: string = process.cwd()): string {
  return runGit(["diff", from, to, ...args], { cwd });
}

export function parseCommits(output: string): Commit[] {
  return output
    .split("\x1e")
    .map((record) => record.replace(/^\n+|\n+$/g, ""))
    .filter(Boolean)
    .map((record) => {
      const [hash = "", shortHash = "", author = "", date = "", ...subjectParts] = record.split("\x00");
      return { hash, shortHash, author, date, subject: subjectParts.join("\x00") };
    });
}

export function listCommits(cwd: string = process.cwd(), args: string[] = []): Commit[] {
  const output = runGit([
    "log",
    "--max-count=500",
    "--date=short",
    "--format=%H%x00%h%x00%an%x00%ad%x00%s%x1e",
    ...args,
  ], { cwd });
  return parseCommits(output);
}

export function getCommitPatch(hash: string, cwd: string = process.cwd()): string {
  return runGit(["show", "--format=", "--patch", hash], { cwd });
}

export function getUnstagedPatch(cwd: string = process.cwd()): string {
  return runGit(["diff", "--no-ext-diff", "--binary"], { cwd });
}

export function listUntrackedFiles(cwd: string = process.cwd()): string[] {
  return runGit(["ls-files", "--others", "--exclude-standard", "-z"], { cwd }).split("\0").filter(Boolean);
}

export function stagePatch(patch: string, cwd: string = process.cwd()): void {
  runGit(["apply", "--cached", "--whitespace=nowarn", "-"], { cwd, input: patch });
}

export function stash(args: string[] = [], cwd: string = process.cwd()): void {
  runGit(["stash", ...args], { cwd, stdio: "inherit" });
}

export function listStashes(cwd: string = process.cwd()): StashEntry[] {
  const output = runGit(["stash", "list", "--format=%gd%x00%gs%x1e"], { cwd });
  return output.split("\x1e").map((record) => record.trim()).filter(Boolean).map((record) => {
    const [ref = "", ...subject] = record.split("\x00");
    return { ref, subject: subject.join("\x00") };
  });
}

export function getStashPatch(ref: string, cwd: string = process.cwd()): string {
  return runGit(["stash", "show", "--patch", "--include-untracked", ref], { cwd });
}

export function hasParentCommit(cwd: string = process.cwd()): boolean {
  return spawnSync("git", ["rev-parse", "--verify", "HEAD^"], { cwd, stdio: "ignore" }).status === 0;
}

export function softUndo(cwd: string = process.cwd()): void {
  runGit(["reset", "--soft", "HEAD~1"], { cwd, stdio: "inherit" });
}

export function listConflicts(cwd: string = process.cwd()): string[] {
  return runGit(["diff", "--name-only", "--diff-filter=U", "-z"], { cwd }).split("\0").filter(Boolean);
}

export function getPathDiff(file: string, cwd: string = process.cwd()): string {
  return runGit(["diff", "--", file], { cwd });
}

export function openInEditor(file: string, cwd: string = process.cwd()): void {
  const editor = process.env.GIT_EDITOR || process.env.VISUAL || process.env.EDITOR || (process.platform === "win32" ? "notepad" : "vi");
  const result = spawnSync(editor, [file], { cwd, stdio: "inherit" });
  if (result.error) throw new Error(`Could not open ${editor}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${editor} exited with status ${result.status}`);
}

export function parseCleanPreview(output: string): string[] {
  return output.split("\n").filter(Boolean).map((line) => line.replace(/^Would remove /, ""));
}

export function listCleanable(cwd: string = process.cwd()): string[] {
  return parseCleanPreview(runGit(["clean", "-nd", "-d"], { cwd }));
}

export function cleanPaths(paths: string[], cwd: string = process.cwd()): void {
  runGit(["clean", "-fd", "--", ...paths], { cwd, stdio: "inherit" });
}

export function listRemotes(cwd: string = process.cwd()): string[] {
  return runGit(["remote"], { cwd }).split("\n").filter(Boolean);
}

export function listRemoteBranches(remote: string, cwd: string = process.cwd()): string[] {
  return runGit(["for-each-ref", "--format=%(refname:strip=3)", `refs/remotes/${remote}`], { cwd })
    .split("\n").filter((branch) => branch && branch !== "HEAD");
}

export function clean(args: string[], cwd: string = process.cwd()): void {
  runGit(["clean", ...args], { cwd, stdio: "inherit" });
}

export function remote(args: string[], cwd: string = process.cwd()): void {
  runGit(["remote", ...args], { cwd, stdio: "inherit" });
}
