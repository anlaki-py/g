import { getCommitPatch, listCommits, type Commit } from "../git.ts";
import { selectItem, type SelectorItem } from "../selectors.ts";
import { showDiff } from "../diff-viewer.ts";

export type LogResult = { empty?: boolean; cancelled?: boolean; commit?: string };

export type LogDeps = {
  listCommits?: (args?: string[]) => Commit[];
  selectItem?: (title: string, items: SelectorItem[]) => Promise<SelectorItem | undefined>;
  getCommitPatch?: (hash: string) => string;
  showDiff?: (patch: string, title: string) => Promise<void>;
};

export async function runLogWorkflow(args: string[] = [], dependencies: LogDeps = {}): Promise<LogResult> {
  const load = dependencies.listCommits ?? ((gitArgs: string[]) => listCommits(process.cwd(), gitArgs));
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
  const commit = selected.commit!;
  await display(patchFor(commit.hash), `${commit.shortHash} ${commit.subject}`);
  return { commit: commit.hash };
}
