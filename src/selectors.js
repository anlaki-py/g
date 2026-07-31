import { createInterface } from "node:readline/promises";
import {
  fuzzyFilter,
  getKeybindings,
  Input,
  Key,
  matchesKey,
  ProcessTerminal,
  truncateToWidth,
  TuiMainScreen,
} from "../tui/dist/index.js";

const cyan = (text) => `\x1b[36m${text}\x1b[39m`;
const dim = (text) => `\x1b[2m${text}\x1b[22m`;

function requireTerminal(label) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(`${label} requires an interactive terminal`);
  }
}

export class SearchSelector {
  constructor({ title, items, multiple = false, onSubmit, onCancel, requestRender }) {
    this.title = title;
    this.items = items;
    this.filtered = items;
    this.multiple = multiple;
    this.onSubmit = onSubmit;
    this.onCancel = onCancel;
    this.requestRender = requestRender;
    this.input = new Input();
    this.selectedIndex = 0;
    this.checked = new Set();
  }

  get focused() { return this.input.focused; }
  set focused(value) { this.input.focused = value; }
  invalidate() { this.input.invalidate(); }

  handleInput(data) {
    const kb = getKeybindings();
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
    if (this.multiple && matchesKey(data, Key.space)) {
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
      this.filtered = fuzzyFilter(this.items, query, (item) => item.searchText ?? `${item.label} ${item.description ?? ""}`);
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
      truncateToWidth(this.title, width, ""),
      truncateToWidth(dim(this.multiple
        ? "Type to filter · Space/Tab toggle · Enter confirm · Esc cancel"
        : "Type to filter · Enter select · Esc cancel"), width, ""),
      ...this.input.render(width),
    ];
    if (this.filtered.length === 0) return [...lines, truncateToWidth(dim("  No matches"), width, "")];

    const maxVisible = 12;
    const start = Math.max(0, Math.min(this.selectedIndex - Math.floor(maxVisible / 2), this.filtered.length - maxVisible));
    const end = Math.min(start + maxVisible, this.filtered.length);
    for (let index = start; index < end; index++) {
      const item = this.filtered[index];
      const active = index === this.selectedIndex;
      const marker = this.multiple ? `[${this.checked.has(item.value) ? "x" : " "}] ` : "";
      const prefix = active ? "→ " : "  ";
      const description = item.description ? dim(` · ${item.description}`) : "";
      const line = `${prefix}${marker}${item.label}${description}`;
      lines.push(truncateToWidth(active ? cyan(line) : line, width, ""));
    }
    if (this.filtered.length > maxVisible) {
      lines.push(truncateToWidth(dim(`  (${this.selectedIndex + 1}/${this.filtered.length})`), width, ""));
    }
    return lines;
  }
}

function runSelector(options) {
  requireTerminal("selection");
  if (options.items.length === 0) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    const terminal = new ProcessTerminal();
    const tui = new TuiMainScreen(terminal);
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
      onCancel: () => finish(undefined),
      requestRender: () => tui.requestRender(),
    });
    tui.addChild(selector);
    tui.setFocus(selector);
    tui.start();
  });
}

export function selectItem(title, items) {
  return runSelector({ title, items, multiple: false });
}

export function selectMany(title, items) {
  return runSelector({ title, items, multiple: true });
}

export function promptText(title, initialValue = "") {
  requireTerminal("input");
  return new Promise((resolve) => {
    const terminal = new ProcessTerminal();
    const tui = new TuiMainScreen(terminal);
    const input = new Input();
    input.setValue(initialValue);
    let finished = false;
    const finish = (value) => {
      if (finished) return;
      finished = true;
      tui.stop();
      resolve(value);
    };
    input.onSubmit = finish;
    input.onEscape = () => finish(undefined);
    tui.addChild({
      invalidate() { input.invalidate(); },
      get focused() { return input.focused; },
      set focused(value) { input.focused = value; },
      handleInput(data) { input.handleInput(data); },
      render(width) {
        return [truncateToWidth(title, width, ""), ...input.render(width)];
      },
    });
    tui.setFocus(tui.children[0]);
    tui.start();
  });
}

export async function confirmAction(title) {
  const selected = await selectItem(title, [
    { value: "yes", label: "Yes" },
    { value: "no", label: "No" },
  ]);
  return selected?.value === "yes";
}

export function isAffirmative(answer) {
  return ["y", "yes"].includes(answer.trim().toLowerCase());
}

export async function confirmBranchCreation(name) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return false;
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await readline.question(`Branch "${name}" does not exist. Create it? [y/N] `);
    return isAffirmative(answer);
  } finally {
    readline.close();
  }
}
