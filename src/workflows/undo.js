import { getCommitPatch, hasParentCommit, listCommits, softUndo } from "../git.js";
import { showDiff } from "../diff-viewer.js";
import { confirmAction } from "../selectors.js";

export async function runUndoWorkflow(dependencies = {}) {
  const canUndo = dependencies.hasParentCommit ?? hasParentCommit;
  const load = dependencies.listCommits ?? (() => listCommits(process.cwd(), ["-1"]));
  const patchFor = dependencies.getCommitPatch ?? getCommitPatch;
  const display = dependencies.showDiff ?? showDiff;
  const confirm = dependencies.confirmAction ?? confirmAction;
  const undo = dependencies.softUndo ?? softUndo;

  if (!canUndo()) throw new Error("the current commit has no parent to undo to");
  const latest = load()[0];
  if (!latest) throw new Error("no commit to undo");
  await display(patchFor(latest.hash), `Undo ${latest.shortHash} ${latest.subject}`);
  if (!await confirm("Undo this commit and keep all changes staged?")) return { cancelled: true };
  undo();
  return { commit: latest.hash };
}
