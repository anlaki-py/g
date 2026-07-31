import assert from "node:assert/strict";
import test from "node:test";

import { run } from "../src/cli.js";

const branches = [
  { name: "feature", current: false },
  { name: "main", current: true },
];

test("b and branch both switch to the selected branch", async () => {
  for (const command of ["b", "branch"]) {
    const switched = [];
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
    const switched = [];
    const code = await run([command, "--detach", "feature/login"], {
      switchBranch: (args) => switched.push(args),
    });
    assert.equal(code, 0);
    assert.deepEqual(switched, [["--detach", "feature/login"]]);
  }
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
    const commitArgs = [];
    const code = await run([command, "describe", "the", "change"], {
      commit: (args) => commitArgs.push(args),
    });
    assert.equal(code, 0);
    assert.deepEqual(commitArgs, [["-m", "describe the change"]]);
  }
});

test("commit uses the default message when none is provided", async () => {
  const commitArgs = [];
  await run(["c"], { commit: (args) => commitArgs.push(args) });
  assert.deepEqual(commitArgs, [["-m", "new commit"]]);
});

test("commit forwards Git options verbatim", async () => {
  const commitArgs = [];
  await run(["commit", "--amend", "--no-edit"], { commit: (args) => commitArgs.push(args) });
  assert.deepEqual(commitArgs, [["--amend", "--no-edit"]]);
});

test("d and diff display the current diff and forward Git arguments", async () => {
  for (const command of ["d", "diff"]) {
    const calls = [];
    const code = await run([command, "--stat"], {
      getCurrentDiff: (args) => { calls.push(["generate", args]); return "patch"; },
      showDiff: async (patch, title) => calls.push(["display", patch, title]),
    });
    assert.equal(code, 0);
    assert.deepEqual(calls, [
      ["generate", ["--stat"]],
      ["display", "patch", "Current changes"],
    ]);
  }
});

test("diff reports when there are no current differences", async () => {
  const output = [];
  const code = await run(["d"], {
    getCurrentDiff: () => "",
    log: (text) => output.push(text),
  });
  assert.equal(code, 0);
  assert.deepEqual(output, ["No differences found."]);
});

test("diff between selects two commits and displays their patch", async () => {
  const from = { hash: "from", shortHash: "1111111" };
  const to = { hash: "to", shortHash: "2222222" };
  const calls = [];
  const code = await run(["diff", "-between", "--stat"], {
    listCommits: () => [from, to],
    selectCommitRange: async (commits) => { calls.push(["select", commits]); return [from, to]; },
    getDiffBetween: (first, second, args) => { calls.push(["generate", first, second, args]); return "patch"; },
    showDiff: async (patch, title) => calls.push(["display", patch, title]),
  });
  assert.equal(code, 0);
  assert.deepEqual(calls, [
    ["select", [from, to]],
    ["generate", "from", "to", ["--stat"]],
    ["display", "patch", "1111111 → 2222222"],
  ]);
});

test("a and add stage all files by default", async () => {
  for (const command of ["a", "add"]) {
    const staged = [];
    const code = await run([command], { add: (paths) => staged.push(paths) });
    assert.equal(code, 0);
    assert.deepEqual(staged, [["."]]);
  }
});

test("add accepts specific paths", async () => {
  const staged = [];
  await run(["add", "src", "README.md"], { add: (paths) => staged.push(paths) });
  assert.deepEqual(staged, [["src", "README.md"]]);
});

test("status, init, pull, and push forward Git arguments", async () => {
  for (const { command, dependency, args } of [
    { command: "s", dependency: "status", args: ["--short"] },
    { command: "init", dependency: "init", args: ["--bare"] },
    { command: "pull", dependency: "pull", args: ["--rebase", "origin", "main"] },
    { command: "push", dependency: "push", args: ["--force-with-lease", "origin", "main"] },
  ]) {
    const received = [];
    const code = await run([command, ...args], { [dependency]: (gitArgs) => received.push(gitArgs) });
    assert.equal(code, 0);
    assert.deepEqual(received, [args]);
  }
});

test("h, -h, and --help show every command", async () => {
  for (const option of ["h", "-h", "--help"]) {
    const output = [];
    const code = await run([option], { log: (text) => output.push(text) });
    assert.equal(code, 0);
    assert.match(output[0], /pull \[args\.\.\.\]/);
    assert.match(output[0], /push \[args\.\.\.\]/);
    assert.match(output[0], /d, diff \[args\.\.\.\]/);
    assert.doesNotMatch(output[0], /p, push/);
  }
});

test("the removed p shortcut is unsupported", async () => {
  const output = [];
  const code = await run(["p"], { log: (text) => output.push(text) });
  assert.equal(code, 1);
  assert.deepEqual(output, ["Usage: g <command> [git arguments...]"]);
});

test("unsupported arguments print usage", async () => {
  const output = [];
  const code = await run(["unknown"], { log: (line) => output.push(line) });
  assert.equal(code, 1);
  assert.deepEqual(output, ["Usage: g <command> [git arguments...]"]);
});
