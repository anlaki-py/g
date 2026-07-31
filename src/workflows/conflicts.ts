import { getPathDiff, listConflicts, openInEditor } from "../git.ts";
import { showDiff } from "../diff-viewer.ts";
import { selectItem, type SelectorItem } from "../selectors.ts";

export type ConflictsResult = { opened: number; empty?: boolean; cancelled?: boolean };

export type ConflictsDeps = {
  listConflicts?: () => string[];
  selectItem?: (title: string, items: SelectorItem[]) => Promise<SelectorItem | undefined>;
  getPathDiff?: (file: string) => string;
  showDiff?: (patch: string, title: string) => Promise<void>;
  openInEditor?: (file: string) => void;
};

export async function runConflictsWorkflow(dependencies: ConflictsDeps = {}): Promise<ConflictsResult> {
  const load = dependencies.listConflicts ?? listConflicts;
  const choose = dependencies.selectItem ?? selectItem;
  const patchFor = dependencies.getPathDiff ?? getPathDiff;
  const display = dependencies.showDiff ?? showDiff;
  const open = dependencies.openInEditor ?? openInEditor;
  let opened = 0;

  while (true) {
    const files = load();
    if (files.length === 0) return { opened, empty: opened === 0 };
    const selected = await choose("Unresolved conflicts", files.map((file) => ({
      value: file,
      label: file,
      searchText: file,
    })));
    if (!selected) return { opened, cancelled: true };
    const action = await choose(selected.value, [
      { value: "open", label: "Open in editor" },
      { value: "preview", label: "Preview conflict diff" },
    ]);
    if (!action) continue;
    if (action.value === "preview") {
      const patch = patchFor(selected.value);
      if (patch) await display(patch, selected.value);
    } else {
      open(selected.value);
      opened++;
    }
  }
}
