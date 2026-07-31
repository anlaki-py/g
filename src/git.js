import { spawnSync } from "node:child_process";

const DEFAULT_MAX_GIT_OUTPUT = 128 * 1024 * 1024;

function runGit(args, options = {}) {
  const result = spawnSync("git", args, {
    cwd: options.cwd,
    encoding: "utf8",
    input: options.input,
    maxBuffer: options.maxBuffer ?? DEFAULT_MAX_GIT_OUTPUT,
    stdio: options.stdio ?? [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
  });

  if (result.error) {
    throw new Error(result.error.code === "ENOENT" ? "Git is not installed" : result.error.message);
  }
  const acceptedStatuses = options.acceptStatuses ?? [0];
  if (!acceptedStatuses.includes(result.status)) {
    const message = result.stderr?.trim() || `Git exited with status ${result.status}`;
    throw new Error(message);
  }

  return result.stdout ?? "";
}

export function parseBranches(output) {
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

export function listBranches(cwd = process.cwd()) {
  const output = runGit(["for-each-ref", "--format=%(HEAD)%09%(refname:short)", "refs/heads"], { cwd });
  return parseBranches(output);
}

export function switchBranch(args, cwd = process.cwd()) {
  runGit(["switch", ...args], { cwd, stdio: "inherit" });
}

export function branchExists(name, cwd = process.cwd()) {
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

export function commit(args, cwd = process.cwd()) {
  runGit(["commit", ...args], { cwd, stdio: "inherit" });
}

export function add(args = ["."], cwd = process.cwd()) {
  runGit(["add", ...args], { cwd, stdio: "inherit" });
}

export function status(args = [], cwd = process.cwd()) {
  runGit(["status", ...args], { cwd, stdio: "inherit" });
}

export function init(args = [], cwd = process.cwd()) {
  runGit(["init", ...args], { cwd, stdio: "inherit" });
}

export function push(args = [], cwd = process.cwd()) {
  runGit(["push", ...args], { cwd, stdio: "inherit" });
}

export function pull(args = [], cwd = process.cwd()) {
  runGit(["pull", ...args], { cwd, stdio: "inherit" });
}

export function getCurrentDiff(args = [], cwd = process.cwd()) {
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
    const patch = runGit(["diff", "--no-index", ...args, "--", "/dev/null", file], {
      cwd,
      acceptStatuses: [0, 1],
    });
    if (patch) return patch;
    return `diff --git a/${file} b/${file}\nnew file mode 100644\n--- /dev/null\n+++ b/${file}\n`;
  });

  return [tracked, ...untracked].filter(Boolean).join("\n");
}

export function getDiffBetween(from, to, args = [], cwd = process.cwd()) {
  return runGit(["diff", from, to, ...args], { cwd });
}

export function parseCommits(output) {
  return output
    .split("\x1e")
    .map((record) => record.replace(/^\n+|\n+$/g, ""))
    .filter(Boolean)
    .map((record) => {
      const [hash, shortHash, author, date, ...subjectParts] = record.split("\x00");
      return { hash, shortHash, author, date, subject: subjectParts.join("\x00") };
    });
}

export function listCommits(cwd = process.cwd(), args = []) {
  const output = runGit([
    "log",
    "--max-count=500",
    "--date=short",
    "--format=%H%x00%h%x00%an%x00%ad%x00%s%x1e",
    ...args,
  ], { cwd });
  return parseCommits(output);
}

export function getCommitPatch(hash, cwd = process.cwd()) {
  return runGit(["show", "--format=", "--patch", hash], { cwd });
}

export function getUnstagedPatch(cwd = process.cwd()) {
  return runGit(["diff", "--no-ext-diff", "--binary"], { cwd });
}

export function listUntrackedFiles(cwd = process.cwd()) {
  return runGit(["ls-files", "--others", "--exclude-standard", "-z"], { cwd }).split("\0").filter(Boolean);
}

export function stagePatch(patch, cwd = process.cwd()) {
  runGit(["apply", "--cached", "--whitespace=nowarn", "-"], { cwd, input: patch });
}

export function stash(args = [], cwd = process.cwd()) {
  runGit(["stash", ...args], { cwd, stdio: "inherit" });
}

export function listStashes(cwd = process.cwd()) {
  const output = runGit(["stash", "list", "--format=%gd%x00%gs%x1e"], { cwd });
  return output.split("\x1e").map((record) => record.trim()).filter(Boolean).map((record) => {
    const [ref, ...subject] = record.split("\x00");
    return { ref, subject: subject.join("\x00") };
  });
}

export function getStashPatch(ref, cwd = process.cwd()) {
  return runGit(["stash", "show", "--patch", "--include-untracked", ref], { cwd });
}

export function hasParentCommit(cwd = process.cwd()) {
  return spawnSync("git", ["rev-parse", "--verify", "HEAD^"], { cwd, stdio: "ignore" }).status === 0;
}

export function softUndo(cwd = process.cwd()) {
  runGit(["reset", "--soft", "HEAD~1"], { cwd, stdio: "inherit" });
}

export function listConflicts(cwd = process.cwd()) {
  return runGit(["diff", "--name-only", "--diff-filter=U", "-z"], { cwd }).split("\0").filter(Boolean);
}

export function getPathDiff(file, cwd = process.cwd()) {
  return runGit(["diff", "--", file], { cwd });
}

export function openInEditor(file, cwd = process.cwd()) {
  const editor = process.env.GIT_EDITOR || process.env.VISUAL || process.env.EDITOR || (process.platform === "win32" ? "notepad" : "vi");
  const result = spawnSync(editor, [file], { cwd, stdio: "inherit" });
  if (result.error) throw new Error(`Could not open ${editor}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${editor} exited with status ${result.status}`);
}

export function parseCleanPreview(output) {
  return output.split("\n").filter(Boolean).map((line) => line.replace(/^Would remove /, ""));
}

export function listCleanable(cwd = process.cwd()) {
  return parseCleanPreview(runGit(["clean", "-nd", "-d"], { cwd }));
}

export function cleanPaths(paths, cwd = process.cwd()) {
  runGit(["clean", "-fd", "--", ...paths], { cwd, stdio: "inherit" });
}

export function listRemotes(cwd = process.cwd()) {
  return runGit(["remote"], { cwd }).split("\n").filter(Boolean);
}

export function listRemoteBranches(remote, cwd = process.cwd()) {
  return runGit(["for-each-ref", "--format=%(refname:strip=3)", `refs/remotes/${remote}`], { cwd })
    .split("\n").filter((branch) => branch && branch !== "HEAD");
}

export function clean(args, cwd = process.cwd()) {
  runGit(["clean", ...args], { cwd, stdio: "inherit" });
}

export function remote(args, cwd = process.cwd()) {
  runGit(["remote", ...args], { cwd, stdio: "inherit" });
}
