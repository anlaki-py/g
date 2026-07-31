import { getStashPatch, listStashes, stash, type StashEntry } from "../git.ts";
import { showDiff } from "../diff-viewer.ts";
import { confirmAction, promptText, selectItem, type SelectorItem } from "../selectors.ts";

export type StashResult = { cancelled?: boolean; empty?: boolean; action?: string; stash?: string };

export type StashDeps = {
  selectItem?: (title: string, items: SelectorItem[]) => Promise<SelectorItem | undefined>;
  promptText?: (title: string, initialValue?: string) => Promise<string | undefined>;
  confirmAction?: (title: string) => Promise<boolean>;
  stash?: (args: string[]) => void;
  listStashes?: () => StashEntry[];
  getStashPatch?: (ref: string) => string;
  showDiff?: (patch: string, title: string) => Promise<void>;
};

export async function runStashWorkflow(dependencies: StashDeps = {}): Promise<StashResult> {
  const choose = dependencies.selectItem ?? selectItem;
  const prompt = dependencies.promptText ?? promptText;
  const confirm = dependencies.confirmAction ?? confirmAction;
  const execute = dependencies.stash ?? stash;
  const load = dependencies.listStashes ?? listStashes;
  const patchFor = dependencies.getStashPatch ?? getStashPatch;
  const display = dependencies.showDiff ?? showDiff;

  const mode = await choose("Stash", [
    { value: "create", label: "Create stash", description: "include untracked files" },
    { value: "manage", label: "Manage stashes", description: "preview, apply, pop, or drop" },
  ]);
  if (!mode) return { cancelled: true };
  if (mode.value === "create") {
    const message = await prompt("Stash message (optional)");
    if (message === undefined) return { cancelled: true };
    execute(message ? ["push", "-u", "-m", message] : ["push", "-u"]);
    return { action: "create" };
  }

  const stashes = load();
  if (stashes.length === 0) return { empty: true };
  const selected = await choose("Select a stash", stashes.map((entry) => ({
    value: entry.ref,
    label: entry.ref,
    description: entry.subject,
    searchText: `${entry.ref} ${entry.subject}`,
    entry,
  })));
  if (!selected) return { cancelled: true };
  const entry = selected.entry!;
  const action = await choose(`${entry.ref} · ${entry.subject}`, [
    { value: "preview", label: "Preview" },
    { value: "apply", label: "Apply" },
    { value: "pop", label: "Pop" },
    { value: "drop", label: "Drop", description: "requires confirmation" },
  ]);
  if (!action) return { cancelled: true };
  if (action.value === "preview") {
    const patch = patchFor(entry.ref);
    if (patch) await display(patch, entry.ref);
  } else if (action.value === "drop") {
    if (!await confirm(`Drop ${entry.ref}?`)) return { cancelled: true };
    execute(["drop", entry.ref]);
  } else {
    execute([action.value, entry.ref]);
  }
  return { action: action.value, stash: entry.ref };
}
