#!/usr/bin/env node

// src/branch-selector.ts
import {
  ProcessTerminal,
  SelectList,
  Text,
  TuiMainScreen
} from "../tui/dist/index.js";
var cyan = (text) => `\x1B[36m${text}\x1B[39m`;
var dim = (text) => `\x1B[2m${text}\x1B[22m`;
var theme = {
  selectedPrefix: cyan,
  selectedText: cyan,
  description: dim,
  scrollInfo: dim,
  noMatch: dim
};
function selectBranch(branches) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("branch selection requires an interactive terminal");
  }
  return new Promise((resolve) => {
    const terminal = new ProcessTerminal();
    const tui = new TuiMainScreen(terminal);
    const items = branches.map((branch) => ({
      value: branch.name,
      label: branch.name,
      description: branch.current ? "current" : void 0
    }));
    const list = new SelectList(items, Math.max(1, Math.min(items.length, 12)), theme);
    const currentIndex = branches.findIndex((branch) => branch.current);
    if (currentIndex >= 0) list.setSelectedIndex(currentIndex);
    let finished = false;
    const finish = (branch) => {
      if (finished) return;
      finished = true;
      tui.stop();
      resolve(branch);
    };
    list.onSelect = (item) => finish(item.value);
    list.onCancel = () => finish(void 0);
    tui.addChild(new Text("Select a branch", 0, 0));
    tui.addChild(list);
    tui.setFocus(list);
    tui.start();
  });
}

// src/commit-selector.ts
import {
  fuzzyFilter,
  getKeybindings,
  Input,
  ProcessTerminal as ProcessTerminal2,
  truncateToWidth,
  TuiMainScreen as TuiMainScreen2
} from "../tui/dist/index.js";
var cyan2 = (text) => `\x1B[36m${text}\x1B[39m`;
var dim2 = (text) => `\x1B[2m${text}\x1B[22m`;
function getCommitSearchText(commit2) {
  return `${commit2.hash} ${commit2.shortHash} ${commit2.subject} ${commit2.author} ${commit2.date}`;
}
function filterCommits(commits, query) {
  return fuzzyFilter(commits, query, getCommitSearchText);
}
var CommitRangeSelector = class {
  commits;
  filtered;
  onSelect;
  onCancel;
  requestRender;
  search;
  selectedIndex = 0;
  first;
  constructor(commits, onSelect, onCancel, requestRender) {
    this.commits = commits;
    this.filtered = commits;
    this.onSelect = onSelect;
    this.onCancel = onCancel;
    this.requestRender = requestRender;
    this.search = new Input();
  }
  get focused() {
    return this.search.focused;
  }
  set focused(value) {
    this.search.focused = value;
  }
  invalidate() {
    this.search.invalidate();
  }
  handleInput(data) {
    const kb = getKeybindings();
    if (kb.matches(data, "tui.select.cancel")) {
      this.onCancel();
      return;
    }
    if (kb.matches(data, "tui.select.up")) {
      this.selectedIndex = this.selectedIndex === 0 ? Math.max(0, this.filtered.length - 1) : this.selectedIndex - 1;
      this.requestRender();
      return;
    }
    if (kb.matches(data, "tui.select.down")) {
      this.selectedIndex = this.selectedIndex >= this.filtered.length - 1 ? 0 : this.selectedIndex + 1;
      this.requestRender();
      return;
    }
    if (kb.matches(data, "tui.select.confirm")) {
      const selected = this.filtered[this.selectedIndex];
      if (!selected) return;
      if (!this.first) {
        this.first = selected;
        this.search.setValue("");
        this.filtered = this.commits.filter((commit2) => commit2.hash !== selected.hash);
        this.selectedIndex = 0;
        this.requestRender();
      } else {
        this.onSelect([this.first, selected]);
      }
      return;
    }
    const previousQuery = this.search.getValue();
    this.search.handleInput(data);
    const query = this.search.getValue();
    if (query !== previousQuery) {
      const first = this.first;
      const available = first ? this.commits.filter((commit2) => commit2.hash !== first.hash) : this.commits;
      this.filtered = filterCommits(available, query);
      this.selectedIndex = 0;
      this.requestRender();
    }
  }
  render(width) {
    const lines = [];
    const heading = this.first ? `Select newer commit \xB7 from ${cyan2(this.first.shortHash)} ${this.first.subject}` : "Select older commit";
    lines.push(truncateToWidth(heading, width, ""));
    lines.push(truncateToWidth(dim2("Search by hash, message, author, or date \xB7 Esc to cancel"), width, ""));
    lines.push(...this.search.render(width));
    if (this.filtered.length === 0) {
      lines.push(truncateToWidth(dim2("  No matching commits"), width, ""));
      return lines;
    }
    const maxVisible = 10;
    const start = Math.max(0, Math.min(
      this.selectedIndex - Math.floor(maxVisible / 2),
      this.filtered.length - maxVisible
    ));
    const end = Math.min(start + maxVisible, this.filtered.length);
    let index = start;
    for (const commit2 of this.filtered.slice(start, end)) {
      const prefix = index === this.selectedIndex ? cyan2("\u2192 ") : "  ";
      const text = `${commit2.shortHash} ${commit2.subject} ${dim2(`\xB7 ${commit2.author} \xB7 ${commit2.date}`)}`;
      lines.push(truncateToWidth(prefix + (index === this.selectedIndex ? cyan2(text) : text), width, ""));
      index++;
    }
    if (this.filtered.length > maxVisible) {
      lines.push(truncateToWidth(dim2(`  (${this.selectedIndex + 1}/${this.filtered.length})`), width, ""));
    }
    return lines;
  }
};
function selectCommitRange(commits) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("commit selection requires an interactive terminal");
  }
  if (commits.length < 2) {
    throw new Error("at least two commits are required");
  }
  return new Promise((resolve) => {
    const terminal = new ProcessTerminal2();
    const tui = new TuiMainScreen2(terminal);
    let finished = false;
    const finish = (range) => {
      if (finished) return;
      finished = true;
      tui.stop();
      resolve(range);
    };
    const selector = new CommitRangeSelector(commits, finish, () => finish(void 0), () => tui.requestRender());
    tui.addChild(selector);
    tui.setFocus(selector);
    tui.start();
  });
}

// src/diff-renderer.ts
import * as Diff from "diff";
var color = (code, text) => `\x1B[${code}m${text}\x1B[0m`;
var added = (text) => color("32", text);
var removed = (text) => color("31", text);
var context = (text) => color("2", text);
var header = (text) => color("1;36", text);
var inverse = (text) => `\x1B[7m${text}\x1B[27m`;
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
function parseUnifiedDiff(patch) {
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
      const type = line.startsWith("diff --git ") ? "fileHeader" : line.startsWith("--- ") ? "oldFile" : line.startsWith("+++ ") ? "newFile" : line ? "meta" : "context";
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
function tryRenderIntraLine(lines, index) {
  const current = lines[index];
  const next = lines[index + 1];
  if (current?.type !== "removed") return void 0;
  if (lines[index - 1]?.type === "removed") return void 0;
  if (next?.type !== "added") return void 0;
  if (lines[index + 2]?.type === "added") return void 0;
  const intra = renderIntraLineDiff(replaceTabs(current.content), replaceTabs(next.content));
  return [
    removed(`-${String(current.lineNumber).padStart(current.width)} ${intra.removedLine}`),
    added(`+${String(next.lineNumber).padStart(next.width)} ${intra.addedLine}`)
  ];
}
function renderDiff(patch) {
  const lines = parseUnifiedDiff(patch);
  const result = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
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
      result.push(context("  \xB7\xB7\xB7"));
    } else if (line.type === "meta" && isUsefulMetadata(line.text)) {
      result.push(context(`  ${line.text}`));
    } else if (line.type === "context") {
      result.push("");
    }
  }
  return result.join("\n");
}

// src/diff-viewer.ts
import {
  decodeKittyPrintable,
  Key,
  matchesKey,
  ProcessTerminal as ProcessTerminal3,
  stripTerminalSequences,
  truncateToWidth as truncateToWidth2,
  TuiAltScreen
} from "../tui/dist/index.js";
var dim3 = (text) => `\x1B[2m${text}\x1B[22m`;
var DiffViewport = class {
  tui;
  allLines;
  title;
  onClose;
  lines;
  offset = 0;
  query = "";
  constructor(tui, patch, title, onClose) {
    this.tui = tui;
    this.allLines = (patch.includes("diff --git ") ? renderDiff(patch) : patch).split("\n");
    this.lines = this.allLines;
    this.title = title;
    this.onClose = onClose;
    this.offset = 0;
    this.query = "";
  }
  invalidate() {
  }
  getPageSize() {
    return Math.max(1, this.tui.terminal.rows - 2);
  }
  scrollBy(lines) {
    const maxOffset = Math.max(0, this.lines.length - this.getPageSize());
    this.offset = Math.max(0, Math.min(maxOffset, this.offset + lines));
    this.tui.requestRender();
  }
  updateFilter(query) {
    this.query = query;
    const normalized = query.toLowerCase();
    this.lines = normalized ? this.allLines.filter((line) => stripTerminalSequences(line).toLowerCase().includes(normalized)) : this.allLines;
    this.offset = 0;
    this.tui.requestRender();
  }
  handleInput(data) {
    const pageSize = this.getPageSize();
    if (matchesKey(data, Key.pageUp) || matchesKey(data, Key.shift("pageUp"))) {
      this.scrollBy(-pageSize);
    } else if (matchesKey(data, Key.pageDown) || matchesKey(data, Key.shift("pageDown"))) {
      this.scrollBy(pageSize);
    } else if (matchesKey(data, Key.up)) {
      this.scrollBy(-1);
    } else if (matchesKey(data, Key.down)) {
      this.scrollBy(1);
    } else if (matchesKey(data, Key.home)) {
      this.offset = 0;
      this.tui.requestRender();
    } else if (matchesKey(data, Key.end)) {
      this.offset = Math.max(0, this.lines.length - pageSize);
      this.tui.requestRender();
    } else if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
      this.onClose();
    } else if (matchesKey(data, Key.backspace)) {
      this.updateFilter(this.query.slice(0, -1));
    } else if (matchesKey(data, Key.ctrl("u"))) {
      this.updateFilter("");
    } else {
      const kittyPrintable = decodeKittyPrintable(data);
      const hasControlCharacters = [...data].some((character) => {
        const code = character.charCodeAt(0);
        return code < 32 || code === 127 || code >= 128 && code <= 159;
      });
      const printable = kittyPrintable ?? (hasControlCharacters ? "" : data);
      if (printable) this.updateFilter(this.query + printable);
    }
  }
  render(width) {
    const pageSize = this.getPageSize();
    const end = Math.min(this.lines.length, this.offset + pageSize);
    const position = this.lines.length > pageSize ? ` \xB7 ${this.offset + 1}-${end}/${this.lines.length}` : ` \xB7 ${this.lines.length}/${this.allLines.length}`;
    const filter = this.query ? `Filter: ${this.query}` : "Type to filter";
    const output = [
      truncateToWidth2(this.title, width, ""),
      truncateToWidth2(dim3(`${filter} \xB7 PgUp/PgDn or \u2191/\u2193 to scroll \xB7 Esc to close${position}`), width, "")
    ];
    for (let i = this.offset; i < end; i++) {
      output.push(truncateToWidth2(this.lines[i] ?? "", width, ""));
    }
    return output;
  }
};
function showDiff(patch, title = "Git diff") {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("diff display requires an interactive terminal");
  }
  return new Promise((resolve) => {
    const terminal = new ProcessTerminal3();
    const tui = new TuiAltScreen(terminal, void 0, void 0, { mouse: false });
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      tui.stop();
      resolve();
    };
    const viewport = new DiffViewport(tui, patch, title, finish);
    tui.addChild(viewport);
    tui.setFocus(viewport);
    tui.start();
  });
}

// src/selectors.ts
import { createInterface } from "node:readline/promises";
import {
  Editor,
  fuzzyFilter as fuzzyFilter2,
  getKeybindings as getKeybindings2,
  Input as Input2,
  Key as Key2,
  matchesKey as matchesKey2,
  ProcessTerminal as ProcessTerminal4,
  truncateToWidth as truncateToWidth3,
  TuiMainScreen as TuiMainScreen3
} from "../tui/dist/index.js";
var cyan3 = (text) => `\x1B[36m${text}\x1B[39m`;
var dim4 = (text) => `\x1B[2m${text}\x1B[22m`;
var editorSelectListTheme = {
  selectedPrefix: cyan3,
  selectedText: cyan3,
  description: dim4,
  scrollInfo: dim4,
  noMatch: dim4
};
function requireTerminal(label) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(`${label} requires an interactive terminal`);
  }
}
var SearchSelector = class {
  title;
  items;
  filtered;
  multiple;
  onSubmit;
  onCancel;
  requestRender;
  input;
  selectedIndex = 0;
  checked = /* @__PURE__ */ new Set();
  constructor(options) {
    this.title = options.title;
    this.items = options.items;
    this.filtered = options.items;
    this.multiple = options.multiple ?? false;
    this.onSubmit = options.onSubmit;
    this.onCancel = options.onCancel;
    this.requestRender = options.requestRender;
    this.input = new Input2();
  }
  get focused() {
    return this.input.focused;
  }
  set focused(value) {
    this.input.focused = value;
  }
  invalidate() {
    this.input.invalidate();
  }
  handleInput(data) {
    const kb = getKeybindings2();
    if (kb.matches(data, "tui.select.cancel")) return this.onCancel();
    if (kb.matches(data, "tui.select.up")) {
      this.selectedIndex = this.selectedIndex === 0 ? Math.max(0, this.filtered.length - 1) : this.selectedIndex - 1;
      return this.requestRender();
    }
    if (kb.matches(data, "tui.select.down")) {
      this.selectedIndex = this.selectedIndex >= this.filtered.length - 1 ? 0 : this.selectedIndex + 1;
      return this.requestRender();
    }
    if (this.multiple && kb.matches(data, "tui.input.tab")) {
      return this.toggleCurrent();
    }
    if (this.multiple && matchesKey2(data, Key2.space)) {
      return this.toggleCurrent();
    }
    if (kb.matches(data, "tui.select.confirm")) {
      if (this.multiple) {
        const selected = this.items.filter((item) => this.checked.has(item.value));
        if (selected.length > 0) this.onSubmit(selected);
      } else {
        const selected = this.filtered[this.selectedIndex];
        if (selected) this.onSubmit(selected);
      }
      return;
    }
    const previous = this.input.getValue();
    this.input.handleInput(data);
    const query = this.input.getValue();
    if (query !== previous) {
      this.filtered = fuzzyFilter2(this.items, query, (item) => item.searchText ?? `${item.label} ${item.description ?? ""}`);
      this.selectedIndex = 0;
      this.requestRender();
    }
  }
  toggleCurrent() {
    const item = this.filtered[this.selectedIndex];
    if (!item) return;
    if (this.checked.has(item.value)) this.checked.delete(item.value);
    else this.checked.add(item.value);
    this.requestRender();
  }
  render(width) {
    const lines = [
      truncateToWidth3(this.title, width, ""),
      truncateToWidth3(dim4(this.multiple ? "Type to filter \xB7 Space/Tab toggle \xB7 Enter confirm \xB7 Esc cancel" : "Type to filter \xB7 Enter select \xB7 Esc cancel"), width, ""),
      ...this.input.render(width)
    ];
    if (this.filtered.length === 0) return [...lines, truncateToWidth3(dim4("  No matches"), width, "")];
    const maxVisible = 12;
    const start = Math.max(0, Math.min(this.selectedIndex - Math.floor(maxVisible / 2), this.filtered.length - maxVisible));
    const end = Math.min(start + maxVisible, this.filtered.length);
    let index = start;
    for (const item of this.filtered.slice(start, end)) {
      const active = index === this.selectedIndex;
      const marker = this.multiple ? `[${this.checked.has(item.value) ? "x" : " "}] ` : "";
      const prefix = active ? "\u2192 " : "  ";
      const description = item.description ? dim4(` \xB7 ${item.description}`) : "";
      const line = `${prefix}${marker}${item.label}${description}`;
      lines.push(truncateToWidth3(active ? cyan3(line) : line, width, ""));
      index++;
    }
    if (this.filtered.length > maxVisible) {
      lines.push(truncateToWidth3(dim4(`  (${this.selectedIndex + 1}/${this.filtered.length})`), width, ""));
    }
    return lines;
  }
};
function runSelector(options) {
  requireTerminal("selection");
  if (options.items.length === 0) return Promise.resolve(void 0);
  return new Promise((resolve) => {
    const terminal = new ProcessTerminal4();
    const tui = new TuiMainScreen3(terminal);
    let finished = false;
    const finish = (value) => {
      if (finished) return;
      finished = true;
      tui.stop();
      resolve(value);
    };
    const selector = new SearchSelector({
      ...options,
      onSubmit: finish,
      onCancel: () => finish(void 0),
      requestRender: () => tui.requestRender()
    });
    tui.addChild(selector);
    tui.setFocus(selector);
    tui.start();
  });
}
function selectItem(title, items) {
  return runSelector({ title, items, multiple: false });
}
function selectMany(title, items) {
  return runSelector({ title, items, multiple: true });
}
function promptText(title, initialValue = "") {
  requireTerminal("input");
  return new Promise((resolve) => {
    const terminal = new ProcessTerminal4();
    const tui = new TuiMainScreen3(terminal);
    const input = new Input2();
    input.setValue(initialValue);
    let finished = false;
    const finish = (value) => {
      if (finished) return;
      finished = true;
      tui.stop();
      resolve(value);
    };
    input.onSubmit = finish;
    input.onEscape = () => finish(void 0);
    const child = {
      invalidate() {
        input.invalidate();
      },
      get focused() {
        return input.focused;
      },
      set focused(value) {
        input.focused = value;
      },
      handleInput(data) {
        const kb = getKeybindings2();
        if (kb.matches(data, "tui.select.cancel") || kb.matches(data, "tui.input.copy")) {
          finish(void 0);
          return;
        }
        input.handleInput(data);
      },
      render(width) {
        return [truncateToWidth3(title, width, ""), ...input.render(width)];
      }
    };
    tui.addChild(child);
    tui.setFocus(child);
    tui.start();
  });
}
function promptCommitMessage() {
  requireTerminal("input");
  return new Promise((resolve) => {
    const terminal = new ProcessTerminal4();
    const tui = new TuiMainScreen3(terminal);
    const editor = new Editor(tui, { borderColor: (text) => text, selectList: editorSelectListTheme });
    let finished = false;
    const finish = (value) => {
      if (finished) return;
      finished = true;
      tui.stop();
      resolve(value);
    };
    editor.onSubmit = finish;
    const child = {
      invalidate() {
        editor.invalidate();
      },
      get focused() {
        return editor.focused;
      },
      set focused(value) {
        editor.focused = value;
      },
      handleInput(data) {
        const kb = getKeybindings2();
        if (kb.matches(data, "tui.select.cancel") || kb.matches(data, "tui.input.copy")) {
          finish(void 0);
          return;
        }
        editor.handleInput(data);
      },
      render(width) {
        return [
          truncateToWidth3(dim4("Commit message \xB7 Enter submit \xB7 Alt+Enter new line \xB7 Esc/Ctrl+C cancel"), width, ""),
          ...editor.render(width)
        ];
      }
    };
    tui.addChild(child);
    tui.setFocus(child);
    tui.start();
  });
}
async function confirmAction(title) {
  const selected = await selectItem(title, [
    { value: "yes", label: "Yes" },
    { value: "no", label: "No" }
  ]);
  return selected?.value === "yes";
}
function isAffirmative(answer) {
  return ["y", "yes"].includes(answer.trim().toLowerCase());
}
async function confirmBranchCreation(name) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return false;
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await readline.question(`Branch "${name}" does not exist. Create it? [y/N] `);
    return isAffirmative(answer);
  } finally {
    readline.close();
  }
}

// src/git.ts
import { spawnSync } from "node:child_process";
var DEFAULT_MAX_GIT_OUTPUT = 128 * 1024 * 1024;
function getNullDevicePath(platform = process.platform) {
  return platform === "win32" ? "NUL" : "/dev/null";
}
function runGit(args, options = {}) {
  const result = spawnSync("git", args, {
    cwd: options.cwd,
    encoding: "utf8",
    input: options.input,
    maxBuffer: options.maxBuffer ?? DEFAULT_MAX_GIT_OUTPUT,
    stdio: options.stdio ?? [options.input === void 0 ? "ignore" : "pipe", "pipe", "pipe"]
  });
  if (result.error) {
    const code = result.error.code;
    throw new Error(code === "ENOENT" ? "Git is not installed" : result.error.message);
  }
  const acceptedStatuses = options.acceptStatuses ?? [0];
  if (!acceptedStatuses.includes(result.status ?? -1)) {
    const message = result.stderr?.trim() || `Git exited with status ${result.status}`;
    throw new Error(message);
  }
  return result.stdout ?? "";
}
function parseBranches(output) {
  return output.split("\n").filter(Boolean).map((line) => {
    const separator = line.indexOf("	");
    const marker = separator === -1 ? "" : line.slice(0, separator);
    const name = separator === -1 ? line : line.slice(separator + 1);
    return { name, current: marker === "*" };
  });
}
function listBranches(cwd = process.cwd()) {
  const output = runGit(["for-each-ref", "--format=%(HEAD)%09%(refname:short)", "refs/heads"], { cwd });
  return parseBranches(output);
}
function switchBranch(args, cwd = process.cwd()) {
  runGit(["switch", ...args], { cwd, stdio: "inherit" });
}
function branchExists(name, cwd = process.cwd()) {
  const local = spawnSync("git", ["show-ref", "--verify", "--quiet", `refs/heads/${name}`], {
    cwd,
    stdio: "ignore"
  });
  if (local.status === 0) return true;
  const remotes = runGit(["for-each-ref", "--format=%(refname:strip=2)", "refs/remotes"], { cwd }).split("\n").filter(Boolean);
  return remotes.some((branch) => branch.endsWith(`/${name}`));
}
function commit(args, cwd = process.cwd()) {
  runGit(["commit", ...args], { cwd, stdio: "inherit" });
}
function add(args = ["."], cwd = process.cwd()) {
  runGit(["add", ...args], { cwd, stdio: "inherit" });
}
function status(args = [], cwd = process.cwd()) {
  runGit(["status", ...args], { cwd, stdio: "inherit" });
}
function init(args = [], cwd = process.cwd()) {
  runGit(["init", ...args], { cwd, stdio: "inherit" });
}
function push(args = [], cwd = process.cwd()) {
  runGit(["push", ...args], { cwd, stdio: "inherit" });
}
function pull(args = [], cwd = process.cwd()) {
  runGit(["pull", ...args], { cwd, stdio: "inherit" });
}
function getCurrentDiff(args = [], cwd = process.cwd()) {
  const head = spawnSync("git", ["rev-parse", "--verify", "HEAD"], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  const tracked = head.status === 0 ? runGit(["diff", "HEAD", ...args], { cwd }) : [
    runGit(["diff", "--cached", ...args], { cwd }),
    runGit(["diff", ...args], { cwd })
  ].filter(Boolean).join("\n");
  const untrackedFiles = runGit(["ls-files", "--others", "--exclude-standard", "-z"], { cwd }).split("\0").filter(Boolean);
  const untracked = untrackedFiles.map((file) => {
    const patch = runGit(["diff", "--no-index", ...args, "--", getNullDevicePath(), file], {
      cwd,
      acceptStatuses: [0, 1]
    });
    if (patch) return patch;
    return `diff --git a/${file} b/${file}
new file mode 100644
--- /dev/null
+++ b/${file}
`;
  });
  return [tracked, ...untracked].filter(Boolean).join("\n");
}
function getDiffBetween(from, to, args = [], cwd = process.cwd()) {
  return runGit(["diff", from, to, ...args], { cwd });
}
function parseCommits(output) {
  return output.split("").map((record) => record.replace(/^\n+|\n+$/g, "")).filter(Boolean).map((record) => {
    const [hash = "", shortHash = "", author = "", date = "", ...subjectParts] = record.split("\0");
    return { hash, shortHash, author, date, subject: subjectParts.join("\0") };
  });
}
function listCommits(cwd = process.cwd(), args = []) {
  const output = runGit([
    "log",
    "--max-count=500",
    "--date=short",
    "--format=%H%x00%h%x00%an%x00%ad%x00%s%x1e",
    ...args
  ], { cwd });
  return parseCommits(output);
}
function getCommitPatch(hash, cwd = process.cwd()) {
  return runGit(["show", "--format=", "--patch", hash], { cwd });
}
function getUnstagedPatch(cwd = process.cwd()) {
  return runGit(["diff", "--no-ext-diff", "--binary"], { cwd });
}
function listUntrackedFiles(cwd = process.cwd()) {
  return runGit(["ls-files", "--others", "--exclude-standard", "-z"], { cwd }).split("\0").filter(Boolean);
}
function stagePatch(patch, cwd = process.cwd()) {
  runGit(["apply", "--cached", "--whitespace=nowarn", "-"], { cwd, input: patch });
}
function stash(args = [], cwd = process.cwd()) {
  runGit(["stash", ...args], { cwd, stdio: "inherit" });
}
function listStashes(cwd = process.cwd()) {
  const output = runGit(["stash", "list", "--format=%gd%x00%gs%x1e"], { cwd });
  return output.split("").map((record) => record.trim()).filter(Boolean).map((record) => {
    const [ref = "", ...subject] = record.split("\0");
    return { ref, subject: subject.join("\0") };
  });
}
function getStashPatch(ref, cwd = process.cwd()) {
  return runGit(["stash", "show", "--patch", "--include-untracked", ref], { cwd });
}
function hasParentCommit(cwd = process.cwd()) {
  return spawnSync("git", ["rev-parse", "--verify", "HEAD^"], { cwd, stdio: "ignore" }).status === 0;
}
function softUndo(cwd = process.cwd()) {
  runGit(["reset", "--soft", "HEAD~1"], { cwd, stdio: "inherit" });
}
function listConflicts(cwd = process.cwd()) {
  return runGit(["diff", "--name-only", "--diff-filter=U", "-z"], { cwd }).split("\0").filter(Boolean);
}
function getPathDiff(file, cwd = process.cwd()) {
  return runGit(["diff", "--", file], { cwd });
}
function openInEditor(file, cwd = process.cwd()) {
  const editor = process.env.GIT_EDITOR || process.env.VISUAL || process.env.EDITOR || (process.platform === "win32" ? "notepad" : "vi");
  const result = spawnSync(editor, [file], { cwd, stdio: "inherit" });
  if (result.error) throw new Error(`Could not open ${editor}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${editor} exited with status ${result.status}`);
}
function parseCleanPreview(output) {
  return output.split("\n").filter(Boolean).map((line) => line.replace(/^Would remove /, ""));
}
function listCleanable(cwd = process.cwd()) {
  return parseCleanPreview(runGit(["clean", "-nd", "-d"], { cwd }));
}
function cleanPaths(paths, cwd = process.cwd()) {
  runGit(["clean", "-fd", "--", ...paths], { cwd, stdio: "inherit" });
}
function listRemotes(cwd = process.cwd()) {
  return runGit(["remote"], { cwd }).split("\n").filter(Boolean);
}
function listRemoteBranches(remote2, cwd = process.cwd()) {
  return runGit(["for-each-ref", "--format=%(refname:strip=3)", `refs/remotes/${remote2}`], { cwd }).split("\n").filter((branch) => branch && branch !== "HEAD");
}
function clean(args, cwd = process.cwd()) {
  runGit(["clean", ...args], { cwd, stdio: "inherit" });
}
function remote(args, cwd = process.cwd()) {
  runGit(["remote", ...args], { cwd, stdio: "inherit" });
}

// src/workflows/clean.ts
async function runCleanWorkflow(dependencies = {}) {
  const load = dependencies.listCleanable ?? listCleanable;
  const choose = dependencies.selectMany ?? selectMany;
  const prompt = dependencies.promptText ?? promptText;
  const remove = dependencies.cleanPaths ?? cleanPaths;
  const paths = load();
  if (paths.length === 0) return { empty: true };
  const selected = await choose("Select untracked paths to permanently delete", paths.map((path) => ({
    value: path,
    label: path,
    searchText: path
  })));
  if (!selected) return { cancelled: true };
  const confirmation = await prompt(`Type DELETE to remove ${selected.length} selected path(s)`);
  if (confirmation !== "DELETE") return { cancelled: true };
  const selectedPaths = selected.map((item) => item.value);
  remove(selectedPaths);
  return { removed: selectedPaths };
}

// src/workflows/conflicts.ts
async function runConflictsWorkflow(dependencies = {}) {
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
      searchText: file
    })));
    if (!selected) return { opened, cancelled: true };
    const action = await choose(selected.value, [
      { value: "open", label: "Open in editor" },
      { value: "preview", label: "Preview conflict diff" }
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

// src/workflows/log.ts
async function runLogWorkflow(args = [], dependencies = {}) {
  const load = dependencies.listCommits ?? ((gitArgs) => listCommits(process.cwd(), gitArgs));
  const choose = dependencies.selectItem ?? selectItem;
  const patchFor = dependencies.getCommitPatch ?? getCommitPatch;
  const display = dependencies.showDiff ?? showDiff;
  const commits = load(args);
  if (commits.length === 0) return { empty: true };
  const selected = await choose("Commit history", commits.map((commit3) => ({
    value: commit3.hash,
    label: `${commit3.shortHash} ${commit3.subject}`,
    description: `${commit3.author} \xB7 ${commit3.date}`,
    searchText: `${commit3.hash} ${commit3.shortHash} ${commit3.subject} ${commit3.author} ${commit3.date}`,
    commit: commit3
  })));
  if (!selected) return { cancelled: true };
  const commit2 = selected.commit;
  await display(patchFor(commit2.hash), `${commit2.shortHash} ${commit2.subject}`);
  return { commit: commit2.hash };
}

// src/workflows/remote.ts
async function runRemoteWorkflow(dependencies = {}) {
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
    { value: "push", label: "Push" }
  ]);
  if (!action) return { cancelled: true };
  const remote2 = await choose("Select remote", remotes.map((name) => ({ value: name, label: name })));
  if (!remote2) return { cancelled: true };
  const branches = action.value === "pull" ? remoteBranches(remote2.value).map((name) => ({ value: name, label: name })) : localBranches().map((branch2) => ({
    value: branch2.name,
    label: branch2.name,
    description: branch2.current ? "current" : void 0
  }));
  if (branches.length === 0) return { empty: true };
  const branch = await choose(`Select branch for ${remote2.value}`, branches);
  if (!branch) return { cancelled: true };
  if (!await confirm(`Run git ${action.value} ${remote2.value} ${branch.value}?`)) return { cancelled: true };
  (action.value === "pull" ? receive : send)([remote2.value, branch.value]);
  return { action: action.value, remote: remote2.value, branch: branch.value };
}

// src/workflows/stage.ts
function parseDiffPath(header2) {
  const match = header2.match(/^diff --git (?:"?a\/)?(.+?)"? (?:"?b\/)?(.+?)"?$/m);
  return match?.[2] ?? "changed file";
}
function splitPatchIntoHunks(patch) {
  const blocks = patch.split(/(?=^diff --git )/m).filter(Boolean);
  const items = [];
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
      const heading = hunk.split("\n", 1)[0];
      const preview = hunk.split("\n").slice(1).find((line) => /^[+-]/.test(line))?.slice(1).trim();
      items.push({ file, index, header: preview || heading, patch: preamble + hunk, preamble, hunk });
    });
  }
  return items;
}
function combineSelectedHunks(selected) {
  const grouped = /* @__PURE__ */ new Map();
  for (const item of selected) {
    const current = grouped.get(item.file);
    if (current) current.hunks.push(item.hunk);
    else grouped.set(item.file, { preamble: item.preamble, hunks: [item.hunk] });
  }
  return [...grouped.values()].map(({ preamble, hunks }) => preamble + hunks.join(""));
}
async function runStageWorkflow(dependencies = {}) {
  const getPatch = dependencies.getUnstagedPatch ?? getUnstagedPatch;
  const getUntracked = dependencies.listUntrackedFiles ?? listUntrackedFiles;
  const choose = dependencies.selectMany ?? selectMany;
  const applyPatch = dependencies.stagePatch ?? stagePatch;
  const stageFiles = dependencies.add ?? add;
  const hunks = splitPatchIntoHunks(getPatch());
  const untracked = getUntracked();
  const items = [
    ...hunks.map((hunk) => ({
      value: `hunk:${hunk.file}:${hunk.index}`,
      label: hunk.file,
      description: hunk.header,
      searchText: `${hunk.file} ${hunk.header} ${hunk.hunk}`,
      kind: "hunk",
      hunk
    })),
    ...untracked.map((file) => ({
      value: `file:${file}`,
      label: file,
      description: "untracked file",
      kind: "file",
      file
    }))
  ];
  if (items.length === 0) return { staged: 0 };
  const selected = await choose("Select changes to stage", items);
  if (!selected) return { staged: 0, cancelled: true };
  const selectedHunks = selected.filter((item) => item.kind === "hunk").map((item) => item.hunk);
  for (const patch of combineSelectedHunks(selectedHunks)) applyPatch(patch);
  const files = selected.filter((item) => item.kind === "file").map((item) => item.file);
  if (files.length > 0) stageFiles(["--", ...files]);
  return { staged: selected.length };
}

// src/workflows/stash.ts
async function runStashWorkflow(dependencies = {}) {
  const choose = dependencies.selectItem ?? selectItem;
  const prompt = dependencies.promptText ?? promptText;
  const confirm = dependencies.confirmAction ?? confirmAction;
  const execute = dependencies.stash ?? stash;
  const load = dependencies.listStashes ?? listStashes;
  const patchFor = dependencies.getStashPatch ?? getStashPatch;
  const display = dependencies.showDiff ?? showDiff;
  const mode = await choose("Stash", [
    { value: "create", label: "Create stash", description: "include untracked files" },
    { value: "manage", label: "Manage stashes", description: "preview, apply, pop, or drop" }
  ]);
  if (!mode) return { cancelled: true };
  if (mode.value === "create") {
    const message = await prompt("Stash message (optional)");
    if (message === void 0) return { cancelled: true };
    execute(message ? ["push", "-u", "-m", message] : ["push", "-u"]);
    return { action: "create" };
  }
  const stashes = load();
  if (stashes.length === 0) return { empty: true };
  const selected = await choose("Select a stash", stashes.map((entry2) => ({
    value: entry2.ref,
    label: entry2.ref,
    description: entry2.subject,
    searchText: `${entry2.ref} ${entry2.subject}`,
    entry: entry2
  })));
  if (!selected) return { cancelled: true };
  const entry = selected.entry;
  const action = await choose(`${entry.ref} \xB7 ${entry.subject}`, [
    { value: "preview", label: "Preview" },
    { value: "apply", label: "Apply" },
    { value: "pop", label: "Pop" },
    { value: "drop", label: "Drop", description: "requires confirmation" }
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

// src/workflows/undo.ts
async function runUndoWorkflow(dependencies = {}) {
  const canUndo = dependencies.hasParentCommit ?? hasParentCommit;
  const load = dependencies.listCommits ?? (() => listCommits(process.cwd(), ["-1"]));
  const patchFor = dependencies.getCommitPatch ?? getCommitPatch;
  const display = dependencies.showDiff ?? showDiff;
  const confirm = dependencies.confirmAction ?? confirmAction;
  const undo = dependencies.softUndo ?? softUndo;
  if (!canUndo()) throw new Error("the current commit has no parent to undo to");
  const latest = load()[0];
  if (!latest) throw new Error("no commit to undo");
  await display(patchFor(latest.hash), `Undo ${latest.shortHash} ${latest.subject}`);
  if (!await confirm("Undo this commit and keep all changes staged?")) return { cancelled: true };
  undo();
  return { commit: latest.hash };
}

// src/workflows/update.ts
import { spawnSync as spawnSync2 } from "node:child_process";

// src/version.ts
import { readFileSync } from "node:fs";
function getCurrentVersion() {
  const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  return packageJson.version;
}

// src/workflows/update.ts
var REPO = "anlaki-py/g";
var ASSET_NAME = "git-shortcut-tui.tgz";
var RELEASE_API_URL = `https://api.github.com/repos/${REPO}/releases/latest`;
var RELEASE_DOWNLOAD_URL = `https://github.com/${REPO}/releases/latest/download/${ASSET_NAME}`;
function normalizeVersion(version) {
  return version.replace(/^v/, "");
}
function compareVersions(a, b) {
  const partsA = normalizeVersion(a).split(".").map((part) => Number.parseInt(part, 10) || 0);
  const partsB = normalizeVersion(b).split(".").map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(partsA.length, partsB.length);
  for (let index = 0; index < length; index++) {
    const difference = (partsA[index] ?? 0) - (partsB[index] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
}
async function getLatestRelease() {
  const response = await fetch(RELEASE_API_URL, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "git-shortcut-tui" },
    signal: AbortSignal.timeout(1e4)
  });
  if (!response.ok) {
    throw new Error(`GitHub API returned ${response.status} ${response.statusText}`);
  }
  const release = await response.json();
  if (!release.tag_name) throw new Error("GitHub API response is missing tag_name");
  return { tag: release.tag_name, url: RELEASE_DOWNLOAD_URL };
}
function installFromUrl(url) {
  const result = spawnSync2(process.platform === "win32" ? "npm.cmd" : "npm", ["install", "--global", url], {
    stdio: "inherit"
  });
  if (result.error) {
    const code = result.error.code;
    throw new Error(code === "ENOENT" ? "npm is not installed" : result.error.message);
  }
  if (result.status !== 0) {
    throw new Error(`npm install exited with status ${result.status}`);
  }
}
async function runUpdateWorkflow(dependencies = {}) {
  const current = dependencies.currentVersion ?? getCurrentVersion;
  const fetchLatest = dependencies.getLatestRelease ?? getLatestRelease;
  const install = dependencies.installFromUrl ?? installFromUrl;
  const from = current();
  let latest;
  try {
    latest = await fetchLatest();
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : String(error) };
  }
  if (compareVersions(latest.tag, from) <= 0) {
    return { status: "up-to-date", version: from };
  }
  try {
    install(latest.url);
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : String(error) };
  }
  return { status: "updated", from, to: normalizeVersion(latest.tag) };
}

// src/cli.ts
var USAGE = "Usage: g <command> [git arguments...]";
var VERSION = getCurrentVersion();
function isSmallDiff(patch, terminalRows = process.stdout.rows) {
  const lineLimit = Math.max(8, Math.min(24, (terminalRows ?? 24) - 4));
  return patch.split("\n").length <= lineLimit;
}
var HELP = `g is a hobbyist Git helper designed to reduce friction while keeping you in control.
It is not intended as professional or production-grade Git tooling.

${USAGE}

Commands:
  a, add [paths...]       Stage files (defaults to .); -p opens hunk selector
  stage                   Interactively stage files and hunks
  b, branch [args...]     Select a branch or run git switch
  c, commit [message]     Commit staged changes (prompts when no message is given)
  d, diff [args...]       Show the current diff
  diff -b|-between        Search and diff two commits
  l, log [args...]        Search commits and preview changes
  stash [args...]         Create or manage stashes
  undo                    Soft-undo the latest commit
  conflicts               Preview and open unresolved files
  clean [args...]         Safely select untracked paths to delete
  remote [args...]        Select a remote operation
  up, update, upgrade     Check for updates and self-update
  i, init [args...]       Initialize a repository
  pull [args...]          Fetch and integrate changes
  push [args...]          Push commits
  s, status [args...]     Show repository status

Options:
  v, -v, --version        Show the version

Direct commands forward trailing Git arguments. Interactive commands show a TUI.`;
async function run(args, dependencies = {}) {
  const list = dependencies.listBranches ?? listBranches;
  const select = dependencies.selectBranch ?? selectBranch;
  const checkout = dependencies.switchBranch ?? switchBranch;
  const hasBranch = dependencies.branchExists ?? branchExists;
  const confirmCreateBranch = dependencies.confirmBranchCreation ?? confirmBranchCreation;
  const createCommit = dependencies.commit ?? commit;
  const stage = dependencies.add ?? add;
  const showStatus = dependencies.status ?? status;
  const initialize = dependencies.init ?? init;
  const send = dependencies.push ?? push;
  const receive = dependencies.pull ?? pull;
  const currentDiff = dependencies.getCurrentDiff ?? getCurrentDiff;
  const betweenDiff = dependencies.getDiffBetween ?? getDiffBetween;
  const commits = dependencies.listCommits ?? listCommits;
  const selectRange = dependencies.selectCommitRange ?? selectCommitRange;
  const displayDiff = dependencies.showDiff ?? showDiff;
  const renderInline = dependencies.renderDiff ?? renderDiff;
  const stageInteractive = dependencies.runStageWorkflow ?? runStageWorkflow;
  const browseLog = dependencies.runLogWorkflow ?? runLogWorkflow;
  const manageStash = dependencies.runStashWorkflow ?? runStashWorkflow;
  const undoLatest = dependencies.runUndoWorkflow ?? runUndoWorkflow;
  const resolveConflicts = dependencies.runConflictsWorkflow ?? runConflictsWorkflow;
  const cleanInteractive = dependencies.runCleanWorkflow ?? runCleanWorkflow;
  const remoteInteractive = dependencies.runRemoteWorkflow ?? runRemoteWorkflow;
  const updateSelf = dependencies.runUpdateWorkflow ?? runUpdateWorkflow;
  const runStash = dependencies.stash ?? stash;
  const runClean = dependencies.clean ?? clean;
  const runRemote = dependencies.remote ?? remote;
  const askForMessage = dependencies.promptCommitMessage ?? promptCommitMessage;
  const log = dependencies.log ?? console.log;
  if (args.length === 1 && ["h", "-h", "--help"].includes(args[0])) {
    log(HELP);
    return 0;
  }
  if (args.length === 1 && ["v", "-v", "--version"].includes(args[0])) {
    log(`g ${VERSION}`);
    return 0;
  }
  if (["i", "init"].includes(args[0])) {
    initialize(args.slice(1));
    return 0;
  }
  if (args[0] === "push") {
    send(args.slice(1));
    return 0;
  }
  if (args[0] === "pull") {
    receive(args.slice(1));
    return 0;
  }
  if (["s", "status"].includes(args[0])) {
    showStatus(args.slice(1));
    if (args.length === 1) log("Next: g stage to select changes, then g c <message> to commit.");
    return 0;
  }
  if (args[0] === "stage" || ["a", "add"].includes(args[0]) && args[1] === "-p") {
    const result = await stageInteractive();
    if (result?.staged === 0 && !result.cancelled) log("No unstaged changes found.");
    return 0;
  }
  if (["l", "log"].includes(args[0])) {
    const result = await browseLog(args.slice(1));
    if (result?.empty) log("No commits found.");
    return 0;
  }
  if (args[0] === "stash") {
    if (args.length > 1) runStash(args.slice(1));
    else {
      const result = await manageStash();
      if (result?.empty) log("No stashes found.");
    }
    return 0;
  }
  if (args[0] === "undo") {
    const result = await undoLatest();
    if (!result?.cancelled) log("Next: adjust the staged changes or run g c <message> to recommit.");
    return 0;
  }
  if (args[0] === "conflicts") {
    const result = await resolveConflicts();
    if (result?.empty) log("No unresolved conflicts.");
    return 0;
  }
  if (args[0] === "clean") {
    if (args.length > 1) runClean(args.slice(1));
    else {
      const result = await cleanInteractive();
      if (result?.empty) log("No cleanable paths found.");
    }
    return 0;
  }
  if (args[0] === "remote") {
    if (args.length > 1) runRemote(args.slice(1));
    else {
      const result = await remoteInteractive();
      if (result?.empty) log("No remotes or branches found.");
    }
    return 0;
  }
  if (["up", "update", "upgrade"].includes(args[0])) {
    const result = await updateSelf();
    if (result?.status === "up-to-date") log(`g is up to date (v${result.version}).`);
    else if (result?.status === "updated") log(`g updated from v${result.from} to v${result.to}.`);
    else if (result?.status === "error") {
      log(`Update failed: ${result.message}`);
      return 1;
    }
    return 0;
  }
  if (["d", "diff"].includes(args[0])) {
    if (["-b", "-between"].includes(args[1])) {
      const range = await selectRange(commits());
      if (!range) return 0;
      const patch2 = betweenDiff(range[0].hash, range[1].hash, args.slice(2));
      if (!patch2.trim()) {
        log("No differences found.");
        return 0;
      }
      await displayDiff(patch2, `${range[0].shortHash} \u2192 ${range[1].shortHash}`);
      return 0;
    }
    const patch = currentDiff(args.slice(1));
    if (!patch.trim()) {
      log("No differences found.");
      return 0;
    }
    if (isSmallDiff(patch)) log(patch.includes("diff --git ") ? renderInline(patch) : patch.trimEnd());
    else await displayDiff(patch, "Current changes");
    return 0;
  }
  if (["a", "add"].includes(args[0])) {
    stage(args.length > 1 ? args.slice(1) : ["."]);
    return 0;
  }
  if (["c", "commit"].includes(args[0])) {
    const commitArgs = args.slice(1);
    if (commitArgs.length === 0) {
      const message = await askForMessage();
      if (message === void 0 || message.trim() === "") return 0;
      createCommit(["-m", message]);
      return 0;
    }
    createCommit(commitArgs.some((arg) => arg.startsWith("-")) ? commitArgs : ["-m", commitArgs.join(" ")]);
    return 0;
  }
  if (!["b", "branch"].includes(args[0])) {
    log(USAGE);
    return 1;
  }
  if (args.length > 1) {
    const target = args[1];
    if (args.length === 2 && target !== void 0 && !target.startsWith("-") && !hasBranch(target)) {
      if (await confirmCreateBranch(target)) checkout(["-c", target]);
      return 0;
    }
    checkout(args.slice(1));
    return 0;
  }
  const branches = list();
  if (branches.length === 0) {
    throw new Error("no local branches found");
  }
  const selected = await select(branches);
  if (selected === void 0) return 0;
  const current = branches.find((branch) => branch.current)?.name;
  if (selected !== current) checkout([selected]);
  return 0;
}

// bin/g.ts
run(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
}).catch((error) => {
  console.error(`g: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
