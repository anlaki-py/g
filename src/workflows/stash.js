import { getStashPatch, listStashes, stash } from "../git.js";
import { showDiff } from "../diff-viewer.js";
import { confirmAction, promptText, selectItem } from "../selectors.js";

export async function runStashWorkflow(dependencies = {}) {
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
  const action = await choose(`${selected.entry.ref} · ${selected.entry.subject}`, [
    { value: "preview", label: "Preview" },
    { value: "apply", label: "Apply" },
    { value: "pop", label: "Pop" },
    { value: "drop", label: "Drop", description: "requires confirmation" },
  ]);
  if (!action) return { cancelled: true };
  if (action.value === "preview") {
    const patch = patchFor(selected.entry.ref);
    if (patch) await display(patch, selected.entry.ref);
  } else if (action.value === "drop") {
    if (!await confirm(`Drop ${selected.entry.ref}?`)) return { cancelled: true };
    execute(["drop", selected.entry.ref]);
  } else {
    execute([action.value, selected.entry.ref]);
  }
  return { action: action.value, stash: selected.entry.ref };
}
