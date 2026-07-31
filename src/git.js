import { spawnSync } from "node:child_process";

function runGit(args, options = {}) {
  const result = spawnSync("git", args, {
    cwd: options.cwd,
    encoding: "utf8",
    stdio: options.stdio ?? ["ignore", "pipe", "pipe"],
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

export function listCommits(cwd = process.cwd()) {
  const output = runGit([
    "log",
    "--max-count=500",
    "--date=short",
    "--format=%H%x00%h%x00%an%x00%ad%x00%s%x1e",
  ], { cwd });
  return parseCommits(output);
}
