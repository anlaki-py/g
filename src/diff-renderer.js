import * as Diff from "diff";

const color = (code, text) => `\x1b[${code}m${text}\x1b[0m`;
const added = (text) => color("32", text);
const removed = (text) => color("31", text);
const context = (text) => color("2", text);
const header = (text) => color("1;36", text);
const inverse = (text) => `\x1b[7m${text}\x1b[27m`;

function replaceTabs(text) {
  return text.replace(/\t/g, "   ");
}

function renderIntraLineDiff(oldContent, newContent) {
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

export function parseUnifiedDiff(patch) {
  const output = [];
  const lines = patch.replace(/\r\n/g, "\n").split("\n");
  let oldLine = 0;
  let newLine = 0;
  let lineNumberWidth = 1;
  let inHunk = false;

  for (const line of lines) {
    const hunk = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[3]);
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

function getDisplayPath(diffHeader) {
  const match = diffHeader.match(/^diff --git (?:"?a\/)?(.+?)"? (?:"?b\/)?(.+?)"?$/);
  return match?.[2] ?? diffHeader.replace(/^diff --git /, "");
}

function isUsefulMetadata(text) {
  return /^(new file mode|deleted file mode|old mode|new mode|similarity index|rename from|rename to|copy from|copy to|Binary files)/.test(text);
}

export function renderDiff(patch) {
  const lines = parseUnifiedDiff(patch);
  const result = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (
      line.type === "removed" &&
      lines[i - 1]?.type !== "removed" &&
      lines[i + 1]?.type === "added" &&
      lines[i + 2]?.type !== "added"
    ) {
      const next = lines[i + 1];
      const intra = renderIntraLineDiff(replaceTabs(line.content), replaceTabs(next.content));
      result.push(removed(`-${String(line.lineNumber).padStart(line.width)} ${intra.removedLine}`));
      result.push(added(`+${String(next.lineNumber).padStart(next.width)} ${intra.addedLine}`));
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
