import { selectBranch } from "./branch-selector.ts";
import { selectCommitRange } from "./commit-selector.ts";
import { renderDiff } from "./diff-renderer.ts";
import { showDiff } from "./diff-viewer.ts";
import { confirmBranchCreation, promptCommitMessage } from "./selectors.ts";
import { runCleanWorkflow, type CleanResult } from "./workflows/clean.ts";
import { runConflictsWorkflow, type ConflictsResult } from "./workflows/conflicts.ts";
import { runLogWorkflow, type LogResult } from "./workflows/log.ts";
import { runRemoteWorkflow, type RemoteResult } from "./workflows/remote.ts";
import { runStageWorkflow, type StageResult } from "./workflows/stage.ts";
import { runStashWorkflow, type StashResult } from "./workflows/stash.ts";
import { runUndoWorkflow, type UndoResult } from "./workflows/undo.ts";
import { runUpdateWorkflow, type UpdateResult } from "./workflows/update.ts";
import { getCurrentVersion } from "./version.ts";
import {
  add,
  branchExists,
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
  type Branch,
  type Commit,
} from "./git.ts";

const USAGE = "Usage: g <command> [git arguments...]";

const VERSION: string = getCurrentVersion();

export function isSmallDiff(patch: string, terminalRows: number | undefined = process.stdout.rows): boolean {
  const lineLimit = Math.max(8, Math.min(24, (terminalRows ?? 24) - 4));
  return patch.split("\n").length <= lineLimit;
}

const HELP = `g is a hobbyist Git helper designed to reduce friction while keeping you in control.
It is not intended as professional or production-grade Git tooling.

${USAGE}

Commands:
  a, add [paths...]       Stage files (defaults to .); -p opens hunk selector
  stage                   Interactively stage files and hunks
  b, branch [args...]     Select a branch or run git switch
  c, commit [message]     Commit staged changes (prompts when no message is given)
  d, diff [args...]       Show the current diff
  diff -b|-between        Search and diff two commits
  l, log [args...]        Search commits and preview changes
  stash [args...]         Create or manage stashes
  undo                    Soft-undo the latest commit
  conflicts               Preview and open unresolved files
  clean [args...]         Safely select untracked paths to delete
  remote [args...]        Select a remote operation
  up, update, upgrade     Check for updates and self-update
  i, init [args...]       Initialize a repository
  pull [args...]          Fetch and integrate changes
  push [args...]          Push commits
  s, status [args...]     Show repository status

Options:
  v, -v, --version        Show the version

Direct commands forward trailing Git arguments. Interactive commands show a TUI.`;

export type Dependencies = {
  listBranches?: () => Branch[];
  selectBranch?: (branches: Branch[]) => Promise<string | undefined>;
  switchBranch?: (args: string[]) => void;
  branchExists?: (name: string) => boolean;
  confirmBranchCreation?: (name: string) => Promise<boolean>;
  commit?: (args: string[]) => void;
  add?: (paths: string[]) => void;
  status?: (args: string[]) => void;
  init?: (args: string[]) => void;
  push?: (args: string[]) => void;
  pull?: (args: string[]) => void;
  getCurrentDiff?: (args: string[]) => string;
  getDiffBetween?: (from: string, to: string, args: string[]) => string;
  listCommits?: (cwd?: string, args?: string[]) => Commit[];
  selectCommitRange?: (commits: Commit[]) => Promise<[Commit, Commit] | undefined>;
  showDiff?: (patch: string, title: string) => Promise<void>;
  renderDiff?: (patch: string) => string;
  runStageWorkflow?: () => Promise<StageResult>;
  runLogWorkflow?: (args: string[]) => Promise<LogResult>;
  runStashWorkflow?: () => Promise<StashResult>;
  runUndoWorkflow?: () => Promise<UndoResult>;
  runConflictsWorkflow?: () => Promise<ConflictsResult>;
  runCleanWorkflow?: () => Promise<CleanResult>;
  runRemoteWorkflow?: () => Promise<RemoteResult>;
  runUpdateWorkflow?: () => Promise<UpdateResult>;
  stash?: (args: string[]) => void;
  clean?: (args: string[]) => void;
  remote?: (args: string[]) => void;
  promptCommitMessage?: () => Promise<string | undefined>;
  log?: (text: string) => void;
};

export async function run(args: string[], dependencies: Dependencies = {}): Promise<number> {
  const list = dependencies.listBranches ?? listBranches;
  const select = dependencies.selectBranch ?? selectBranch;
  const checkout = dependencies.switchBranch ?? switchBranch;
  const hasBranch = dependencies.branchExists ?? branchExists;
  const confirmCreateBranch = dependencies.confirmBranchCreation ?? confirmBranchCreation;
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
  const renderInline = dependencies.renderDiff ?? renderDiff;
  const stageInteractive = dependencies.runStageWorkflow ?? runStageWorkflow;
  const browseLog = dependencies.runLogWorkflow ?? runLogWorkflow;
  const manageStash = dependencies.runStashWorkflow ?? runStashWorkflow;
  const undoLatest = dependencies.runUndoWorkflow ?? runUndoWorkflow;
  const resolveConflicts = dependencies.runConflictsWorkflow ?? runConflictsWorkflow;
  const cleanInteractive = dependencies.runCleanWorkflow ?? runCleanWorkflow;
  const remoteInteractive = dependencies.runRemoteWorkflow ?? runRemoteWorkflow;
  const updateSelf = dependencies.runUpdateWorkflow ?? runUpdateWorkflow;
  const runStash = dependencies.stash ?? stash;
  const runClean = dependencies.clean ?? clean;
  const runRemote = dependencies.remote ?? remote;
  const askForMessage = dependencies.promptCommitMessage ?? promptCommitMessage;
  const log = dependencies.log ?? console.log;

  if (args.length === 1 && ["h", "-h", "--help"].includes(args[0]!)) {
    log(HELP);
    return 0;
  }

  if (args.length === 1 && ["v", "-v", "--version"].includes(args[0]!)) {
    log(`g ${VERSION}`);
    return 0;
  }

  if (["i", "init"].includes(args[0]!)) {
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

  if (["s", "status"].includes(args[0]!)) {
    showStatus(args.slice(1));
    if (args.length === 1) log("Next: g stage to select changes, then g c <message> to commit.");
    return 0;
  }

  if (args[0] === "stage" || (["a", "add"].includes(args[0]!) && args[1] === "-p")) {
    const result = await stageInteractive();
    if (result?.staged === 0 && !result.cancelled) log("No unstaged changes found.");
    return 0;
  }

  if (["l", "log"].includes(args[0]!)) {
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
    const result = await undoLatest();
    if (!result?.cancelled) log("Next: adjust the staged changes or run g c <message> to recommit.");
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

  if (["up", "update", "upgrade"].includes(args[0]!)) {
    const result = await updateSelf();
    if (result?.status === "up-to-date") log(`g is up to date (v${result.version}).`);
    else if (result?.status === "updated") log(`g updated from v${result.from} to v${result.to}.`);
    else if (result?.status === "error") {
      log(`Update failed: ${result.message}`);
      return 1;
    }
    return 0;
  }

  if (["d", "diff"].includes(args[0]!)) {
    if (["-b", "-between"].includes(args[1]!)) {
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
    if (isSmallDiff(patch)) log(patch.includes("diff --git ") ? renderInline(patch) : patch.trimEnd());
    else await displayDiff(patch, "Current changes");
    return 0;
  }

  if (["a", "add"].includes(args[0]!)) {
    stage(args.length > 1 ? args.slice(1) : ["."]);
    return 0;
  }

  if (["c", "commit"].includes(args[0]!)) {
    const commitArgs = args.slice(1);
    if (commitArgs.length === 0) {
      const message = await askForMessage();
      if (message === undefined || message.trim() === "") return 0;
      createCommit(["-m", message]);
      return 0;
    }
    createCommit(commitArgs.some((arg) => arg.startsWith("-"))
      ? commitArgs
      : ["-m", commitArgs.join(" ")]);
    return 0;
  }

  if (!["b", "branch"].includes(args[0]!)) {
    log(USAGE);
    return 1;
  }

  if (args.length > 1) {
    const target = args[1];
    if (args.length === 2 && target !== undefined && !target.startsWith("-") && !hasBranch(target)) {
      if (await confirmCreateBranch(target)) checkout(["-c", target]);
      return 0;
    }
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
