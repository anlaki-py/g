import { cleanPaths, listCleanable } from "../git.ts";
import { promptText, selectMany, type SelectorItem } from "../selectors.ts";

export type CleanResult = { empty?: boolean; cancelled?: boolean; removed?: string[] };

export type CleanDeps = {
  listCleanable?: () => string[];
  selectMany?: (title: string, items: SelectorItem[]) => Promise<SelectorItem[] | undefined>;
  promptText?: (title: string, initialValue?: string) => Promise<string | undefined>;
  cleanPaths?: (paths: string[]) => void;
};

export async function runCleanWorkflow(dependencies: CleanDeps = {}): Promise<CleanResult> {
  const load = dependencies.listCleanable ?? listCleanable;
  const choose = dependencies.selectMany ?? selectMany;
  const prompt = dependencies.promptText ?? promptText;
  const remove = dependencies.cleanPaths ?? cleanPaths;
  const paths = load();
  if (paths.length === 0) return { empty: true };
  const selected = await choose("Select untracked paths to permanently delete", paths.map((path) => ({
    value: path,
    label: path,
    searchText: path,
  })));
  if (!selected) return { cancelled: true };
  const confirmation = await prompt(`Type DELETE to remove ${selected.length} selected path(s)`);
  if (confirmation !== "DELETE") return { cancelled: true };
  const selectedPaths = selected.map((item) => item.value);
  remove(selectedPaths);
  return { removed: selectedPaths };
}
