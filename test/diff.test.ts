import assert from "node:assert/strict";
import test from "node:test";

/* eslint-disable no-control-regex -- these tests assert on ANSI escape sequences in rendered diffs */

import { CommitRangeSelector, filterCommits, getCommitSearchText } from "../src/commit-selector.ts";
import { parseUnifiedDiff, renderDiff } from "../src/diff-renderer.ts";
import { DiffViewport } from "../src/diff-viewer.ts";
import { visibleWidth } from "../tui/dist/index.js";

const patch = `diff --git a/file.js b/file.js
index 1234567..7654321 100644
--- a/file.js
+++ b/file.js
@@ -1,2 +1,2 @@
-const color = "red";
+const color = "blue";
 unchanged
`;

test("parseUnifiedDiff adds old and new line numbers", () => {
  const lines = parseUnifiedDiff(patch);
  assert.ok(lines.some((line) => line.type === "removed" && line.lineNumber === 1));
  assert.ok(lines.some((line) => line.type === "added" && line.lineNumber === 1));
  assert.ok(lines.some((line) => line.type === "contextLine" && line.lineNumber === 2));
});

test("renderDiff colors lines and highlights changed words", () => {
  const rendered = renderDiff(patch);
  assert.match(rendered, /\x1b\[31m-1/);
  assert.match(rendered, /\x1b\[32m\+1/);
  assert.match(rendered, /\x1b\[7mred/);
  assert.match(rendered, /\x1b\[7mblue/);
  assert.match(rendered, /\x1b\[1;36mfile\.js/);
  assert.doesNotMatch(rendered, /diff --git|index 1234567|--- a\/file\.js|\+\+\+ b\/file\.js|@@ -1/);
});

const commits = [
  { hash: "a".repeat(40), shortHash: "aaaaaaa", subject: "Fix login", author: "Ada", date: "2026-01-02" },
  { hash: "b".repeat(40), shortHash: "bbbbbbb", subject: "Add dashboard", author: "Grace", date: "2026-01-03" },
];

test("DiffViewport renders one page and accepts plain PageDown", () => {
  const longPatch = `diff --git a/file b/file\n--- a/file\n+++ b/file\n@@ -1,8 +1,8 @@\n${Array.from(
    { length: 8 },
    (_, index) => ` line ${index + 1}`,
  ).join("\n")}`;
  let renders = 0;
  const tui = { terminal: { rows: 6 }, requestRender: () => { renders += 1; } };
  const viewport = new DiffViewport(tui, longPatch, "Diff", () => {});

  assert.equal(viewport.render(80).length, 6);
  viewport.handleInput("\x1b[6~");
  assert.ok(viewport.offset > 0);
  assert.equal(renders, 1);
  assert.equal(viewport.render(80).length, 6);

  viewport.handleInput("z");
  assert.equal(viewport.query, "z");
  assert.equal(viewport.lines.length, 0);
  viewport.handleInput("\x7f");
  assert.equal(viewport.query, "");
  assert.ok(viewport.lines.length > 0);
});

test("commit range selector truncates a long selected commit heading", () => {
  const longCommit = {
    hash: "a".repeat(40),
    shortHash: "aaaaaaa",
    subject: "A very long commit subject ".repeat(30),
    author: "Ada",
    date: "2026-01-02",
  };
  const otherCommit = {
    hash: "b".repeat(40),
    shortHash: "bbbbbbb",
    subject: "Next commit",
    author: "Grace",
    date: "2026-01-03",
  };
  const selector = new CommitRangeSelector([longCommit, otherCommit], () => {}, () => {}, () => {});
  selector.handleInput("\r");

  const width = 40;
  assert.ok(selector.render(width).every((line) => visibleWidth(line) <= width));
});

test("commit search covers hash, message, author, and date", () => {
  assert.match(getCommitSearchText(commits[0]!), /Fix login Ada 2026-01-02/);
  assert.deepEqual(filterCommits(commits, "dashboard"), [commits[1]]);
  assert.deepEqual(filterCommits(commits, "2026-01-02"), [commits[0]]);
  assert.deepEqual(filterCommits(commits, "bbbb"), [commits[1]]);
});
