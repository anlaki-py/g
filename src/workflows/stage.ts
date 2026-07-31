import { add, getUnstagedPatch, listUntrackedFiles, stagePatch } from "../git.ts";
import { selectMany, type SelectorItem } from "../selectors.ts";

export type StageHunk = NonNullable<SelectorItem["hunk"]>;

export type StageResult = { staged: number; cancelled?: boolean };

export type StageDeps = {
  getUnstagedPatch?: () => string;
  listUntrackedFiles?: () => string[];
  selectMany?: (title: string, items: SelectorItem[]) => Promise<SelectorItem[] | undefined>;
  stagePatch?: (patch: string) => void;
  add?: (paths: string[]) => void;
};

function parseDiffPath(header: string): string {
  const match = header.match(/^diff --git (?:"?a\/)?(.+?)"? (?:"?b\/)?(.+?)"?$/m);
  return match?.[2] ?? "changed file";
}

export function splitPatchIntoHunks(patch: string): StageHunk[] {
  const blocks = patch.split(/(?=^diff --git )/m).filter(Boolean);
  const items: StageHunk[] = [];
  for (const block of blocks) {
    const firstHunk = block.search(/^@@ /m);
    const preamble = firstHunk === -1 ? block : block.slice(0, firstHunk);
    const file = parseDiffPath(block);
    if (firstHunk === -1) {
      items.push({ file, index: 0, header: "whole file", patch: block, preamble: "", hunk: block });
      continue;
    }
    const hunks = block.slice(firstHunk).split(/(?=^@@ )/m).filter(Boolean);
    hunks.forEach((hunk, index) => {
      const heading = hunk.split("\n", 1)[0]!;
      const preview = hunk.split("\n").slice(1).find((line) => /^[+-]/.test(line))?.slice(1).trim();
      items.push({ file, index, header: preview || heading, patch: preamble + hunk, preamble, hunk });
    });
  }
  return items;
}

export function combineSelectedHunks(selected: StageHunk[]): string[] {
  const grouped = new Map<string, { preamble: string; hunks: string[] }>();
  for (const item of selected) {
    const current = grouped.get(item.file);
    if (current) current.hunks.push(item.hunk);
    else grouped.set(item.file, { preamble: item.preamble, hunks: [item.hunk] });
  }
  return [...grouped.values()].map(({ preamble, hunks }) => preamble + hunks.join(""));
}

export async function runStageWorkflow(dependencies: StageDeps = {}): Promise<StageResult> {
  const getPatch = dependencies.getUnstagedPatch ?? getUnstagedPatch;
  const getUntracked = dependencies.listUntrackedFiles ?? listUntrackedFiles;
  const choose = dependencies.selectMany ?? selectMany;
  const applyPatch = dependencies.stagePatch ?? stagePatch;
  const stageFiles = dependencies.add ?? add;

  const hunks = splitPatchIntoHunks(getPatch());
  const untracked = getUntracked();
  const items: SelectorItem[] = [
    ...hunks.map((hunk) => ({
      value: `hunk:${hunk.file}:${hunk.index}`,
      label: hunk.file,
      description: hunk.header,
      searchText: `${hunk.file} ${hunk.header} ${hunk.hunk}`,
      kind: "hunk" as const,
      hunk,
    })),
    ...untracked.map((file) => ({
      value: `file:${file}`,
      label: file,
      description: "untracked file",
      kind: "file" as const,
      file,
    })),
  ];
  if (items.length === 0) return { staged: 0 };
  const selected = await choose("Select changes to stage", items);
  if (!selected) return { staged: 0, cancelled: true };

  const selectedHunks = selected
    .filter((item): item is SelectorItem & { kind: "hunk"; hunk: StageHunk } => item.kind === "hunk")
    .map((item) => item.hunk);
  for (const patch of combineSelectedHunks(selectedHunks)) applyPatch(patch);
  const files = selected
    .filter((item): item is SelectorItem & { kind: "file"; file: string } => item.kind === "file")
    .map((item) => item.file);
  if (files.length > 0) stageFiles(["--", ...files]);
  return { staged: selected.length };
}
