import { getCommitPatch, listCommits } from "../git.js";
import { selectItem } from "../selectors.js";
import { showDiff } from "../diff-viewer.js";

export async function runLogWorkflow(args = [], dependencies = {}) {
  const load = dependencies.listCommits ?? ((gitArgs) => listCommits(process.cwd(), gitArgs));
  const choose = dependencies.selectItem ?? selectItem;
  const patchFor = dependencies.getCommitPatch ?? getCommitPatch;
  const display = dependencies.showDiff ?? showDiff;
  const commits = load(args);
  if (commits.length === 0) return { empty: true };
  const selected = await choose("Commit history", commits.map((commit) => ({
    value: commit.hash,
    label: `${commit.shortHash} ${commit.subject}`,
    description: `${commit.author} · ${commit.date}`,
    searchText: `${commit.hash} ${commit.shortHash} ${commit.subject} ${commit.author} ${commit.date}`,
    commit,
  })));
  if (!selected) return { cancelled: true };
  await display(patchFor(selected.commit.hash), `${selected.commit.shortHash} ${selected.commit.subject}`);
  return { commit: selected.commit.hash };
}
