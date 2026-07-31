import { listBranches, listRemoteBranches, listRemotes, pull, push } from "../git.js";
import { confirmAction, selectItem } from "../selectors.js";

export async function runRemoteWorkflow(dependencies = {}) {
  const choose = dependencies.selectItem ?? selectItem;
  const confirm = dependencies.confirmAction ?? confirmAction;
  const remotes = (dependencies.listRemotes ?? listRemotes)();
  const remoteBranches = dependencies.listRemoteBranches ?? listRemoteBranches;
  const localBranches = dependencies.listBranches ?? listBranches;
  const receive = dependencies.pull ?? pull;
  const send = dependencies.push ?? push;
  if (remotes.length === 0) return { empty: true };

  const action = await choose("Remote action", [
    { value: "pull", label: "Pull" },
    { value: "push", label: "Push" },
  ]);
  if (!action) return { cancelled: true };
  const remote = await choose("Select remote", remotes.map((name) => ({ value: name, label: name })));
  if (!remote) return { cancelled: true };
  const branches = action.value === "pull"
    ? remoteBranches(remote.value).map((name) => ({ value: name, label: name }))
    : localBranches().map((branch) => ({
        value: branch.name,
        label: branch.name,
        description: branch.current ? "current" : undefined,
      }));
  if (branches.length === 0) return { empty: true };
  const branch = await choose(`Select branch for ${remote.value}`, branches);
  if (!branch) return { cancelled: true };
  if (!await confirm(`Run git ${action.value} ${remote.value} ${branch.value}?`)) return { cancelled: true };
  (action.value === "pull" ? receive : send)([remote.value, branch.value]);
  return { action: action.value, remote: remote.value, branch: branch.value };
}
