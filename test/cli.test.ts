import assert from "node:assert/strict";
import test from "node:test";

import { run } from "../src/cli.ts";
import type { Commit } from "../src/git.ts";

const branches = [
  { name: "feature", current: false },
  { name: "main", current: true },
];

test("b and branch both switch to the selected branch", async () => {
  for (const command of ["b", "branch"]) {
    const switched: string[][] = [];
    const code = await run([command], {
      listBranches: () => branches,
      selectBranch: async () => "feature",
      switchBranch: (branch) => switched.push(branch),
    });
    assert.equal(code, 0);
    assert.deepEqual(switched, [["feature"]]);
  }
});

test("b and branch switch directly when a branch name is provided", async () => {
  for (const command of ["b", "branch"]) {
    const switched: string[][] = [];
    const code = await run([command, "--detach", "feature/login"], {
      switchBranch: (args) => switched.push(args),
    });
    assert.equal(code, 0);
    assert.deepEqual(switched, [["--detach", "feature/login"]]);
  }
});

test("two-argument switch flags are forwarded without a branch prompt", async () => {
  for (const flag of ["-f", "-t", "-d"]) {
    const switched: string[][] = [];
    let checkedBranch = false;
    let prompted = false;
    const code = await run(["b", flag], {
      branchExists: () => { checkedBranch = true; return false; },
      confirmBranchCreation: async () => { prompted = true; return false; },
      switchBranch: (args) => switched.push(args),
    });
    assert.equal(code, 0);
    assert.equal(checkedBranch, false);
    assert.equal(prompted, false);
    assert.deepEqual(switched, [[flag]]);
  }
});

test("a missing direct branch is created only after confirmation", async () => {
  for (const confirmed of [false, true]) {
    const switched: string[][] = [];
    const prompts: string[] = [];
    const code = await run(["b", "new-feature"], {
      branchExists: () => false,
      confirmBranchCreation: async (name) => { prompts.push(name); return confirmed; },
      switchBranch: (args) => switched.push(args),
    });
    assert.equal(code, 0);
    assert.deepEqual(prompts, ["new-feature"]);
    assert.deepEqual(switched, confirmed ? [["-c", "new-feature"]] : []);
  }
});

test("an existing direct branch switches without prompting", async () => {
  const switched: string[][] = [];
  let prompted = false;
  await run(["branch", "main"], {
    branchExists: () => true,
    confirmBranchCreation: async () => { prompted = true; return false; },
    switchBranch: (args) => switched.push(args),
  });
  assert.equal(prompted, false);
  assert.deepEqual(switched, [["main"]]);
});

test("cancelling does not switch branches", async () => {
  let switched = false;
  const code = await run(["b"], {
    listBranches: () => branches,
    selectBranch: async () => undefined,
    switchBranch: () => { switched = true; },
  });
  assert.equal(code, 0);
  assert.equal(switched, false);
});

test("selecting the current branch does not run git switch", async () => {
  let switched = false;
  await run(["b"], {
    listBranches: () => branches,
    selectBranch: async () => "main",
    switchBranch: () => { switched = true; },
  });
  assert.equal(switched, false);
});

test("c and commit create a commit with the provided message", async () => {
  for (const command of ["c", "commit"]) {
    const commitArgs: string[][] = [];
    const code = await run([command, "describe", "the", "change"], {
      commit: (args) => commitArgs.push(args),
    });
    assert.equal(code, 0);
    assert.deepEqual(commitArgs, [["-m", "describe the change"]]);
  }
});

test("commit without a message prompts and commits the returned message", async () => {
  const commitArgs: string[][] = [];
  const code = await run(["c"], {
    promptCommitMessage: async () => "prompted message",
    commit: (args) => commitArgs.push(args),
  });
  assert.equal(code, 0);
  assert.deepEqual(commitArgs, [["-m", "prompted message"]]);
});

test("cancelling the commit prompt does not commit", async () => {
  const commitArgs: string[][] = [];
  const code = await run(["c"], {
    promptCommitMessage: async () => undefined,
    commit: (args) => commitArgs.push(args),
  });
  assert.equal(code, 0);
  assert.deepEqual(commitArgs, []);
});

test("an empty prompt result does not commit", async () => {
  const commitArgs: string[][] = [];
  const code = await run(["c"], {
    promptCommitMessage: async () => "   ",
    commit: (args) => commitArgs.push(args),
  });
  assert.equal(code, 0);
  assert.deepEqual(commitArgs, []);
});

test("commit forwards Git options verbatim", async () => {
  const commitArgs: string[][] = [];
  await run(["commit", "--amend", "--no-edit"], { commit: (args) => commitArgs.push(args) });
  assert.deepEqual(commitArgs, [["--amend", "--no-edit"]]);
});

test("d and diff display the current diff and forward Git arguments", async () => {
  for (const command of ["d", "diff"]) {
    const calls: unknown[][] = [];
    const code = await run([command, "--stat"], {
      getCurrentDiff: (args) => { calls.push(["generate", args]); return Array(30).fill("patch").join("\n"); },
      showDiff: async (patch, title) => { calls.push(["display", patch, title]); },
    });
    assert.equal(code, 0);
    assert.deepEqual(calls, [
      ["generate", ["--stat"]],
      ["display", Array(30).fill("patch").join("\n"), "Current changes"],
    ]);
  }
});

test("small current diffs render inline without opening the viewer", async () => {
  const output: string[] = [];
  let opened = false;
  const code = await run(["d"], {
    getCurrentDiff: () => "diff --git a/file b/file\n@@ -1 +1 @@\n-old\n+new",
    renderDiff: () => "rendered diff",
    showDiff: async () => { opened = true; },
    log: (text) => output.push(text),
  });
  assert.equal(code, 0);
  assert.equal(opened, false);
  assert.deepEqual(output, ["rendered diff"]);
});

test("diff reports when there are no current differences", async () => {
  const output: string[] = [];
  const code = await run(["d"], {
    getCurrentDiff: () => "",
    log: (text) => output.push(text),
  });
  assert.equal(code, 0);
  assert.deepEqual(output, ["No differences found."]);
});

test("diff between selects two commits and displays their patch", async () => {
  const from: Commit = { hash: "from", shortHash: "1111111", subject: "", author: "", date: "" };
  const to: Commit = { hash: "to", shortHash: "2222222", subject: "", author: "", date: "" };
  const calls: unknown[][] = [];
  const code = await run(["diff", "-between", "--stat"], {
    listCommits: () => [from, to],
    selectCommitRange: async (commits) => { calls.push(["select", commits]); return [from, to]; },
    getDiffBetween: (first, second, args) => { calls.push(["generate", first, second, args]); return "patch"; },
    showDiff: async (patch, title) => { calls.push(["display", patch, title]); },
  });
  assert.equal(code, 0);
  assert.deepEqual(calls, [
    ["select", [from, to]],
    ["generate", "from", "to", ["--stat"]],
    ["display", "patch", "1111111 → 2222222"],
  ]);
});

test("interactive workflow commands route to their workflows", async () => {
  for (const { args, dependency } of [
    { args: ["stage"], dependency: "runStageWorkflow" },
    { args: ["a", "-p"], dependency: "runStageWorkflow" },
    { args: ["log", "--all"], dependency: "runLogWorkflow" },
    { args: ["stash"], dependency: "runStashWorkflow" },
    { args: ["undo"], dependency: "runUndoWorkflow" },
    { args: ["conflicts"], dependency: "runConflictsWorkflow" },
    { args: ["clean"], dependency: "runCleanWorkflow" },
    { args: ["remote"], dependency: "runRemoteWorkflow" },
  ] as const) {
    const calls: unknown[][] = [];
    const code = await run([...args], {
      [dependency]: async (...values: unknown[]) => {
        calls.push(values);
        return { staged: 0, opened: 0 };
      },
      log() {},
    });
    assert.equal(code, 0);
    assert.equal(calls.length, 1);
    if (dependency === "runLogWorkflow") assert.deepEqual(calls[0], [["--all"]]);
  }
});

test("stash, clean, and remote forward explicit native arguments", async () => {
  for (const { args, dependency } of [
    { args: ["stash", "list"], dependency: "stash" },
    { args: ["clean", "-n"], dependency: "clean" },
    { args: ["remote", "-v"], dependency: "remote" },
  ] as const) {
    const received: string[][] = [];
    await run([...args], { [dependency]: (values: string[]) => received.push(values) });
    assert.deepEqual(received, [args.slice(1)]);
  }
});

test("a and add stage all files by default", async () => {
  for (const command of ["a", "add"]) {
    const staged: string[][] = [];
    const code = await run([command], { add: (paths) => staged.push(paths) });
    assert.equal(code, 0);
    assert.deepEqual(staged, [["."]]);
  }
});

test("add accepts specific paths", async () => {
  const staged: string[][] = [];
  await run(["add", "src", "README.md"], { add: (paths) => staged.push(paths) });
  assert.deepEqual(staged, [["src", "README.md"]]);
});

test("status and undo print useful next-step hints", async () => {
  const output: string[] = [];
  await run(["s"], { status() {}, log: (text) => output.push(text) });
  await run(["undo"], {
    runUndoWorkflow: async () => ({ commit: "abc" }),
    log: (text) => output.push(text),
  });
  assert.match(output[0]!, /g stage/);
  assert.match(output[1]!, /g c <message>/);
});

test("status, init, pull, and push forward Git arguments", async () => {
  for (const { command, dependency, args } of [
    { command: "s", dependency: "status", args: ["--short"] },
    { command: "init", dependency: "init", args: ["--bare"] },
    { command: "pull", dependency: "pull", args: ["--rebase", "origin", "main"] },
    { command: "push", dependency: "push", args: ["--force-with-lease", "origin", "main"] },
  ] as const) {
    const received: string[][] = [];
    const code = await run([command, ...args], { [dependency]: (gitArgs: string[]) => received.push(gitArgs) });
    assert.equal(code, 0);
    assert.deepEqual(received, [args]);
  }
});

test("h, -h, and --help show every command", async () => {
  for (const option of ["h", "-h", "--help"]) {
    const output: string[] = [];
    const code = await run([option], { log: (text) => output.push(text) });
    assert.equal(code, 0);
    assert.match(output[0]!, /pull \[args\.\.\.\]/);
    assert.match(output[0]!, /push \[args\.\.\.\]/);
    assert.match(output[0]!, /d, diff \[args\.\.\.\]/);
    assert.doesNotMatch(output[0]!, /p, push/);
  }
});

test("v, -v, and --version print the package version", async () => {
  for (const option of ["v", "-v", "--version"]) {
    const output: string[] = [];
    const code = await run([option], { log: (text) => output.push(text) });
    assert.equal(code, 0);
    assert.match(output[0]!, /^g \d+\.\d+\.\d+$/);
  }
});

test("the removed p shortcut is unsupported", async () => {
  const output: string[] = [];
  const code = await run(["p"], { log: (text) => output.push(text) });
  assert.equal(code, 1);
  assert.deepEqual(output, ["Usage: g <command> [git arguments...]"]);
});

test("unsupported arguments print usage", async () => {
  const output: string[] = [];
  const code = await run(["unknown"], { log: (line) => output.push(line) });
  assert.equal(code, 1);
  assert.deepEqual(output, ["Usage: g <command> [git arguments...]"]);
});
