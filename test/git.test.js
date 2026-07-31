import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { getCurrentDiff, parseBranches, parseCommits } from "../src/git.js";

test("parseBranches parses local branches and marks the current branch", () => {
  assert.deepEqual(parseBranches("\tfeature/login\n*\tmain\n"), [
    { name: "feature/login", current: false },
    { name: "main", current: true },
  ]);
});

test("parseBranches handles empty output", () => {
  assert.deepEqual(parseBranches(""), []);
});

test("parseCommits parses structured log records", () => {
  const output = "fullhash\x00abc1234\x00Ada\x002026-01-02\x00Fix login\x1e\n";
  assert.deepEqual(parseCommits(output), [{
    hash: "fullhash",
    shortHash: "abc1234",
    author: "Ada",
    date: "2026-01-02",
    subject: "Fix login",
  }]);
});

test("getCurrentDiff includes untracked and empty files", () => {
  const cwd = mkdtempSync(join(tmpdir(), "g-diff-"));
  try {
    assert.equal(spawnSync("git", ["init", "-q"], { cwd }).status, 0);
    writeFileSync(join(cwd, "new.txt"), "untracked content\n");
    writeFileSync(join(cwd, "empty.txt"), "");

    const patch = getCurrentDiff([], cwd);
    assert.match(patch, /new\.txt/);
    assert.match(patch, /\+untracked content/);
    assert.match(patch, /empty\.txt/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
