import * as Diff from "diff";

const color = (code: string, text: string): string => `\x1b[${code}m${text}\x1b[0m`;
const added = (text: string): string => color("32", text);
const removed = (text: string): string => color("31", text);
const context = (text: string): string => color("2", text);
const header = (text: string): string => color("1;36", text);
const inverse = (text: string): string => `\x1b[7m${text}\x1b[27m`;

function replaceTabs(text: string): string {
  return text.replace(/\t/g, "   ");
}

function renderIntraLineDiff(oldContent: string, newContent: string): { removedLine: string; addedLine: string } {
  const parts = Diff.diffWords(oldContent, newContent);
  let removedLine = "";
  let addedLine = "";
  let firstRemoved = true;
  let firstAdded = true;

  for (const part of parts) {
    if (part.removed) {
      let value = part.value;
      if (firstRemoved) {
        const whitespace = value.match(/^\s*/)?.[0] ?? "";
        removedLine += whitespace;
        value = value.slice(whitespace.length);
        firstRemoved = false;
      }
      removedLine += value ? inverse(value) : "";
    } else if (part.added) {
      let value = part.value;
      if (firstAdded) {
        const whitespace = value.match(/^\s*/)?.[0] ?? "";
        addedLine += whitespace;
        value = value.slice(whitespace.length);
        firstAdded = false;
      }
      addedLine += value ? inverse(value) : "";
    } else {
      removedLine += part.value;
      addedLine += part.value;
    }
  }

  return { removedLine, addedLine };
}

export type DiffLine =
  | { type: "hunk"; text: string }
  | { type: "fileHeader"; text: string }
  | { type: "oldFile"; text: string }
  | { type: "newFile"; text: string }
  | { type: "meta"; text: string }
  | { type: "context"; text: string }
  | { type: "removed"; lineNumber: number; content: string; width: number }
  | { type: "added"; lineNumber: number; content: string; width: number }
  | { type: "contextLine"; lineNumber: number; content: string; width: number };

export function parseUnifiedDiff(patch: string): DiffLine[] {
  const output: DiffLine[] = [];
  const lines = patch.replace(/\r\n/g, "\n").split("\n");
  let oldLine = 0;
  let newLine = 0;
  let lineNumberWidth = 1;
  let inHunk = false;

  for (const line of lines) {
    const hunk = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/);
    if (hunk) {
      oldLine = Number(hunk[1]!);
      newLine = Number(hunk[3]!);
      const oldEnd = Math.max(oldLine, oldLine + Number(hunk[2] ?? 1) - 1);
      const newEnd = Math.max(newLine, newLine + Number(hunk[4] ?? 1) - 1);
      lineNumberWidth = Math.max(String(oldEnd).length, String(newEnd).length);
      inHunk = true;
      output.push({ type: "hunk", text: line });
      continue;
    }

    if (!inHunk || line.startsWith("\\ No newline at end of file")) {
      const type = line.startsWith("diff --git ")
        ? "fileHeader"
        : line.startsWith("--- ")
          ? "oldFile"
          : line.startsWith("+++ ")
            ? "newFile"
            : line
              ? "meta"
              : "context";
      output.push({ type, text: line });
      continue;
    }

    if (line.startsWith("-")) {
      output.push({ type: "removed", lineNumber: oldLine, content: line.slice(1), width: lineNumberWidth });
      oldLine++;
    } else if (line.startsWith("+")) {
      output.push({ type: "added", lineNumber: newLine, content: line.slice(1), width: lineNumberWidth });
      newLine++;
    } else if (line.startsWith(" ")) {
      output.push({ type: "contextLine", lineNumber: oldLine, content: line.slice(1), width: lineNumberWidth });
      oldLine++;
      newLine++;
    } else {
      inHunk = false;
      output.push({ type: "meta", text: line });
    }
  }

  return output;
}

function getDisplayPath(diffHeader: string): string {
  const match = diffHeader.match(/^diff --git (?:"?a\/)?(.+?)"? (?:"?b\/)?(.+?)"?$/);
  return match?.[2] ?? diffHeader.replace(/^diff --git /, "");
}

function isUsefulMetadata(text: string): boolean {
  return /^(new file mode|deleted file mode|old mode|new mode|similarity index|rename from|rename to|copy from|copy to|Binary files)/.test(text);
}

/** Render a removed/added line pair with intra-line highlighting, or undefined when not a single modified line. */
function tryRenderIntraLine(lines: DiffLine[], index: number): string[] | undefined {
  const current = lines[index];
  const next = lines[index + 1];
  if (current?.type !== "removed") return undefined;
  if (lines[index - 1]?.type === "removed") return undefined;
  if (next?.type !== "added") return undefined;
  if (lines[index + 2]?.type === "added") return undefined;

  const intra = renderIntraLineDiff(replaceTabs(current.content), replaceTabs(next.content));
  return [
    removed(`-${String(current.lineNumber).padStart(current.width)} ${intra.removedLine}`),
    added(`+${String(next.lineNumber).padStart(next.width)} ${intra.addedLine}`),
  ];
}

export function renderDiff(patch: string): string {
  const lines = parseUnifiedDiff(patch);
  const result: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const intraLines = tryRenderIntraLine(lines, i);
    if (intraLines) {
      result.push(...intraLines);
      i++;
    } else if (line.type === "removed" || line.type === "added") {
      const text = `${line.type === "removed" ? "-" : "+"}${String(line.lineNumber).padStart(line.width)} ${replaceTabs(line.content)}`;
      result.push((line.type === "removed" ? removed : added)(text));
    } else if (line.type === "contextLine") {
      result.push(context(` ${String(line.lineNumber).padStart(line.width)} ${replaceTabs(line.content)}`));
    } else if (line.type === "fileHeader") {
      if (result.length > 0) result.push("");
      result.push(header(getDisplayPath(line.text)));
    } else if (line.type === "hunk") {
      result.push(context("  ···"));
    } else if (line.type === "meta" && isUsefulMetadata(line.text)) {
      result.push(context(`  ${line.text}`));
    } else if (line.type === "context") {
      result.push("");
    }
  }

  return result.join("\n");
}
