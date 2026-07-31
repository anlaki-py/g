import assert from "node:assert/strict";
import test from "node:test";

import { compareVersions, normalizeVersion, runUpdateWorkflow } from "../src/workflows/update.ts";

test("normalizeVersion strips a leading v", () => {
  assert.equal(normalizeVersion("v0.1.5"), "0.1.5");
  assert.equal(normalizeVersion("0.1.5"), "0.1.5");
});

test("compareVersions orders versions numerically component-wise", () => {
  assert.equal(compareVersions("0.1.5", "0.1.4"), 1);
  assert.equal(compareVersions("v0.1.4", "0.1.4"), 0);
  assert.equal(compareVersions("0.2.0", "0.10.0"), -1);
  assert.equal(compareVersions("0.1.4", "0.1.10"), -1);
});

test("update reports up-to-date and does not install when the latest release is not newer", async () => {
  let installed = 0;
  const result = await runUpdateWorkflow({
    currentVersion: () => "0.1.4",
    getLatestRelease: async () => ({ tag: "v0.1.4", url: "https://example.test/g.tgz" }),
    installFromUrl: () => { installed += 1; },
  });
  assert.deepEqual(result, { status: "up-to-date", version: "0.1.4" });
  assert.equal(installed, 0);
});

test("update installs the latest release when a newer version exists", async () => {
  const installed: string[] = [];
  const result = await runUpdateWorkflow({
    currentVersion: () => "0.1.4",
    getLatestRelease: async () => ({ tag: "v0.1.5", url: "https://example.test/g.tgz" }),
    installFromUrl: (url) => installed.push(url),
  });
  assert.deepEqual(result, { status: "updated", from: "0.1.4", to: "0.1.5" });
  assert.deepEqual(installed, ["https://example.test/g.tgz"]);
});

test("update reports an error when fetching the latest release fails", async () => {
  const result = await runUpdateWorkflow({
    currentVersion: () => "0.1.4",
    getLatestRelease: async () => { throw new Error("GitHub API returned 403"); },
  });
  assert.equal(result.status, "error");
  if (result.status === "error") assert.match(result.message, /403/);
});

test("update reports an error when the npm install fails", async () => {
  const result = await runUpdateWorkflow({
    currentVersion: () => "0.1.4",
    getLatestRelease: async () => ({ tag: "v0.1.5", url: "https://example.test/g.tgz" }),
    installFromUrl: () => { throw new Error("npm is not installed"); },
  });
  assert.equal(result.status, "error");
  if (result.status === "error") assert.match(result.message, /npm/);
});
