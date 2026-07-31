import assert from "node:assert/strict";
import test from "node:test";

import { isAffirmative, SearchSelector } from "../src/selectors.js";
import { visibleWidth } from "../tui/dist/index.js";
import { runCleanWorkflow } from "../src/workflows/clean.js";
import { runConflictsWorkflow } from "../src/workflows/conflicts.js";
import { runLogWorkflow } from "../src/workflows/log.js";
import { runRemoteWorkflow } from "../src/workflows/remote.js";
import { combineSelectedHunks, runStageWorkflow, splitPatchIntoHunks } from "../src/workflows/stage.js";
import { runStashWorkflow } from "../src/workflows/stash.js";
import { runUndoWorkflow } from "../src/workflows/undo.js";

test("branch creation confirmation defaults to no", () => {
  assert.equal(isAffirmative(""), false);
  assert.equal(isAffirmative("n"), false);
  assert.equal(isAffirmative("Y"), true);
  assert.equal(isAffirmative("yes"), true);
});

test("shared selector keeps long content within terminal width", () => {
  const selector = new SearchSelector({
    title: "Long title ".repeat(20),
    items: [{ value: "one", label: "Long item ".repeat(30), description: "details" }],
    onSubmit() {},
    onCancel() {},
    requestRender() {},
  });
  assert.ok(selector.render(32).every((line) => visibleWidth(line) <= 32));
});

const patch = `diff --git a/file.txt b/file.txt
index 1111111..2222222 100644
--- a/file.txt
+++ b/file.txt
@@ -1 +1 @@
-old one
+new one
@@ -10 +10 @@
-old two
+new two
`;

test("stage patch parser splits and recombines selected hunks", () => {
  const hunks = splitPatchIntoHunks(patch);
  assert.equal(hunks.length, 2);
  const combined = combineSelectedHunks(hunks);
  assert.equal(combined.length, 1);
  assert.match(combined[0], /new one/);
  assert.match(combined[0], /new two/);
});

test("interactive stage applies selected hunks and adds selected untracked files", async () => {
  const applied = [];
  const added = [];
  const result = await runStageWorkflow({
    getUnstagedPatch: () => patch,
    listUntrackedFiles: () => ["new.txt"],
    selectMany: async (_title, items) => [items[0], items.at(-1)],
    stagePatch: (value) => applied.push(value),
    add: (args) => added.push(args),
  });
  assert.equal(result.staged, 2);
  assert.equal(applied.length, 1);
  assert.deepEqual(added, [["--", "new.txt"]]);
});

test("log workflow previews the selected commit", async () => {
  const commit = { hash: "abc", shortHash: "abc", subject: "Change", author: "Ada", date: "2026-01-01" };
  const shown = [];
  await runLogWorkflow(["--all"], {
    listCommits: (args) => { assert.deepEqual(args, ["--all"]); return [commit]; },
    selectItem: async (_title, items) => items[0],
    getCommitPatch: () => "patch",
    showDiff: async (...args) => shown.push(args),
  });
  assert.deepEqual(shown, [["patch", "abc Change"]]);
});

test("stash drop requires confirmation", async () => {
  const executed = [];
  const choices = [
    { value: "manage" },
    { value: "stash@{0}", entry: { ref: "stash@{0}", subject: "work" } },
    { value: "drop" },
  ];
  const result = await runStashWorkflow({
    selectItem: async () => choices.shift(),
    listStashes: () => [{ ref: "stash@{0}", subject: "work" }],
    confirmAction: async () => false,
    stash: (args) => executed.push(args),
  });
  assert.equal(result.cancelled, true);
  assert.deepEqual(executed, []);
});

test("undo previews and performs only a soft undo after confirmation", async () => {
  let undone = 0;
  await runUndoWorkflow({
    hasParentCommit: () => true,
    listCommits: () => [{ hash: "abc", shortHash: "abc", subject: "Change" }],
    getCommitPatch: () => "patch",
    showDiff: async () => {},
    confirmAction: async () => true,
    softUndo: () => { undone += 1; },
  });
  assert.equal(undone, 1);
});

test("conflict workflow opens a file and refreshes the conflict list", async () => {
  const conflictLists = [["file.txt"], []];
  const selections = [{ value: "file.txt" }, { value: "open" }];
  const opened = [];
  const result = await runConflictsWorkflow({
    listConflicts: () => conflictLists.shift(),
    selectItem: async () => selections.shift(),
    openInEditor: (file) => opened.push(file),
  });
  assert.deepEqual(opened, ["file.txt"]);
  assert.equal(result.opened, 1);
});

test("clean requires the exact DELETE confirmation", async () => {
  let removed = false;
  const result = await runCleanWorkflow({
    listCleanable: () => ["temp.txt"],
    selectMany: async (_title, items) => items,
    promptText: async () => "delete",
    cleanPaths: () => { removed = true; },
  });
  assert.equal(result.cancelled, true);
  assert.equal(removed, false);
});

test("remote workflow confirms and executes the selected operation", async () => {
  const selections = [
    { value: "push" },
    { value: "origin" },
    { value: "main" },
  ];
  const pushed = [];
  await runRemoteWorkflow({
    selectItem: async () => selections.shift(),
    confirmAction: async () => true,
    listRemotes: () => ["origin"],
    listBranches: () => [{ name: "main", current: true }],
    push: (args) => pushed.push(args),
  });
  assert.deepEqual(pushed, [["origin", "main"]]);
});
