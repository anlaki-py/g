import { selectBranch } from "./branch-selector.js";
import { selectCommitRange } from "./commit-selector.js";
import { showDiff } from "./diff-viewer.js";
import { runCleanWorkflow } from "./workflows/clean.js";
import { runConflictsWorkflow } from "./workflows/conflicts.js";
import { runLogWorkflow } from "./workflows/log.js";
import { runRemoteWorkflow } from "./workflows/remote.js";
import { runStageWorkflow } from "./workflows/stage.js";
import { runStashWorkflow } from "./workflows/stash.js";
import { runUndoWorkflow } from "./workflows/undo.js";
import {
  add,
  clean,
  commit,
  getCurrentDiff,
  getDiffBetween,
  init,
  listBranches,
  listCommits,
  pull,
  push,
  remote,
  stash,
  status,
  switchBranch,
} from "./git.js";

const USAGE = "Usage: g <command> [git arguments...]";
const HELP = `${USAGE}

Commands:
  a, add [paths...]       Stage files (defaults to .); -p opens hunk selector
  stage                   Interactively stage files and hunks
  b, branch [args...]     Select a branch or run git switch
  c, commit [message]     Commit staged changes (defaults to "new commit")
  d, diff [args...]       Show the current diff
  diff -b|-between        Search and diff two commits
  l, log [args...]        Search commits and preview changes
  stash [args...]         Create or manage stashes
  undo                    Soft-undo the latest commit
  conflicts               Preview and open unresolved files
  clean [args...]         Safely select untracked paths to delete
  remote [args...]        Select a remote operation
  i, init [args...]       Initialize a repository
  pull [args...]          Fetch and integrate changes
  push [args...]          Push commits
  s, status [args...]     Show repository status

Direct commands forward trailing Git arguments. Interactive commands show a TUI.`;

export async function run(args, dependencies = {}) {
  const list = dependencies.listBranches ?? listBranches;
  const select = dependencies.selectBranch ?? selectBranch;
  const checkout = dependencies.switchBranch ?? switchBranch;
  const createCommit = dependencies.commit ?? commit;
  const stage = dependencies.add ?? add;
  const showStatus = dependencies.status ?? status;
  const initialize = dependencies.init ?? init;
  const send = dependencies.push ?? push;
  const receive = dependencies.pull ?? pull;
  const currentDiff = dependencies.getCurrentDiff ?? getCurrentDiff;
  const betweenDiff = dependencies.getDiffBetween ?? getDiffBetween;
  const commits = dependencies.listCommits ?? listCommits;
  const selectRange = dependencies.selectCommitRange ?? selectCommitRange;
  const displayDiff = dependencies.showDiff ?? showDiff;
  const stageInteractive = dependencies.runStageWorkflow ?? runStageWorkflow;
  const browseLog = dependencies.runLogWorkflow ?? runLogWorkflow;
  const manageStash = dependencies.runStashWorkflow ?? runStashWorkflow;
  const undoLatest = dependencies.runUndoWorkflow ?? runUndoWorkflow;
  const resolveConflicts = dependencies.runConflictsWorkflow ?? runConflictsWorkflow;
  const cleanInteractive = dependencies.runCleanWorkflow ?? runCleanWorkflow;
  const remoteInteractive = dependencies.runRemoteWorkflow ?? runRemoteWorkflow;
  const runStash = dependencies.stash ?? stash;
  const runClean = dependencies.clean ?? clean;
  const runRemote = dependencies.remote ?? remote;
  const log = dependencies.log ?? console.log;

  if (args.length === 1 && ["h", "-h", "--help"].includes(args[0])) {
    log(HELP);
    return 0;
  }

  if (["i", "init"].includes(args[0])) {
    initialize(args.slice(1));
    return 0;
  }

  if (args[0] === "push") {
    send(args.slice(1));
    return 0;
  }

  if (args[0] === "pull") {
    receive(args.slice(1));
    return 0;
  }

  if (["s", "status"].includes(args[0])) {
    showStatus(args.slice(1));
    return 0;
  }

  if (args[0] === "stage" || (["a", "add"].includes(args[0]) && args[1] === "-p")) {
    const result = await stageInteractive();
    if (result?.staged === 0 && !result.cancelled) log("No unstaged changes found.");
    return 0;
  }

  if (["l", "log"].includes(args[0])) {
    const result = await browseLog(args.slice(1));
    if (result?.empty) log("No commits found.");
    return 0;
  }

  if (args[0] === "stash") {
    if (args.length > 1) runStash(args.slice(1));
    else {
      const result = await manageStash();
      if (result?.empty) log("No stashes found.");
    }
    return 0;
  }

  if (args[0] === "undo") {
    await undoLatest();
    return 0;
  }

  if (args[0] === "conflicts") {
    const result = await resolveConflicts();
    if (result?.empty) log("No unresolved conflicts.");
    return 0;
  }

  if (args[0] === "clean") {
    if (args.length > 1) runClean(args.slice(1));
    else {
      const result = await cleanInteractive();
      if (result?.empty) log("No cleanable paths found.");
    }
    return 0;
  }

  if (args[0] === "remote") {
    if (args.length > 1) runRemote(args.slice(1));
    else {
      const result = await remoteInteractive();
      if (result?.empty) log("No remotes or branches found.");
    }
    return 0;
  }

  if (["d", "diff"].includes(args[0])) {
    if (["-b", "-between"].includes(args[1])) {
      const range = await selectRange(commits());
      if (!range) return 0;
      const patch = betweenDiff(range[0].hash, range[1].hash, args.slice(2));
      if (!patch.trim()) {
        log("No differences found.");
        return 0;
      }
      await displayDiff(patch, `${range[0].shortHash} → ${range[1].shortHash}`);
      return 0;
    }

    const patch = currentDiff(args.slice(1));
    if (!patch.trim()) {
      log("No differences found.");
      return 0;
    }
    await displayDiff(patch, "Current changes");
    return 0;
  }

  if (["a", "add"].includes(args[0])) {
    stage(args.length > 1 ? args.slice(1) : ["."]);
    return 0;
  }

  if (["c", "commit"].includes(args[0])) {
    const commitArgs = args.slice(1);
    createCommit(commitArgs.length === 0
      ? ["-m", "new commit"]
      : commitArgs.some((arg) => arg.startsWith("-"))
        ? commitArgs
        : ["-m", commitArgs.join(" ")]);
    return 0;
  }

  if (!["b", "branch"].includes(args[0])) {
    log(USAGE);
    return 1;
  }

  if (args.length > 1) {
    checkout(args.slice(1));
    return 0;
  }

  const branches = list();
  if (branches.length === 0) {
    throw new Error("no local branches found");
  }

  const selected = await select(branches);
  if (selected === undefined) return 0;

  const current = branches.find((branch) => branch.current)?.name;
  if (selected !== current) checkout([selected]);
  return 0;
}
