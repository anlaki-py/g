import { selectBranch } from "./branch-selector.js";
import { selectCommitRange } from "./commit-selector.js";
import { showDiff } from "./diff-viewer.js";
import {
  add,
  commit,
  getCurrentDiff,
  getDiffBetween,
  init,
  listBranches,
  listCommits,
  pull,
  push,
  status,
  switchBranch,
} from "./git.js";

const USAGE = "Usage: g <command> [git arguments...]";
const HELP = `${USAGE}

Commands:
  a, add [paths...]       Stage files (defaults to .)
  b, branch [args...]     Select a branch or run git switch
  c, commit [message]     Commit staged changes (defaults to "new commit")
  d, diff [args...]       Show the current diff
  diff -b|-between        Search and diff two commits
  i, init [args...]       Initialize a repository
  pull [args...]          Fetch and integrate changes
  push [args...]          Push commits
  s, status [args...]     Show repository status

All trailing arguments are forwarded to the corresponding Git command.`;

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
