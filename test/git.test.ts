import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { getCommitPatch, getCurrentDiff, getNullDevicePath, parseBranches, parseCommits } from "../src/git.ts";

test("uses the platform-specific null device", () => {
  assert.equal(getNullDevicePath("linux"), "/dev/null");
  assert.equal(getNullDevicePath("darwin"), "/dev/null");
  assert.equal(getNullDevicePath("win32"), "NUL");
});

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

test("getCommitPatch supports output larger than spawnSync's default buffer", () => {
  const cwd = mkdtempSync(join(tmpdir(), "g-large-patch-"));
  try {
    assert.equal(spawnSync("git", ["init", "-q"], { cwd }).status, 0);
    assert.equal(spawnSync("git", ["config", "user.email", "test@example.com"], { cwd }).status, 0);
    assert.equal(spawnSync("git", ["config", "user.name", "Test"], { cwd }).status, 0);
    writeFileSync(join(cwd, "large.txt"), "x".repeat(2 * 1024 * 1024));
    assert.equal(spawnSync("git", ["add", "large.txt"], { cwd }).status, 0);
    assert.equal(spawnSync("git", ["commit", "-qm", "large patch"], { cwd }).status, 0);

    const patch = getCommitPatch("HEAD", cwd);
    assert.ok(patch.length > 1024 * 1024);
    assert.match(patch, /large\.txt/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
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
