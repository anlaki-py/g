import { createInterface } from "node:readline/promises";
import {
  Editor,
  fuzzyFilter,
  getKeybindings,
  Input,
  Key,
  matchesKey,
  ProcessTerminal,
  truncateToWidth,
  TuiMainScreen,
  type Component,
  type Focusable,
  type SelectListTheme,
} from "../tui/dist/index.js";
import type { Commit, StashEntry } from "./git.ts";

const cyan = (text: string): string => `\x1b[36m${text}\x1b[39m`;
const dim = (text: string): string => `\x1b[2m${text}\x1b[22m`;
const editorSelectListTheme: SelectListTheme = {
  selectedPrefix: cyan,
  selectedText: cyan,
  description: dim,
  scrollInfo: dim,
  noMatch: dim,
};

/**
 * A selectable list item. Workflows attach their own payloads (commit, entry,
 * hunk, file) to items and read them back from the selected result.
 */
export type SelectorItem = {
  value: string;
  label: string;
  description?: string;
  searchText?: string;
  commit?: Commit;
  entry?: StashEntry;
  kind?: "hunk" | "file";
  hunk?: {
    file: string;
    index: number;
    header: string;
    patch: string;
    preamble: string;
    hunk: string;
  };
  file?: string;
};

function requireTerminal(label: string): void {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(`${label} requires an interactive terminal`);
  }
}

export class SearchSelector implements Component, Focusable {
  private readonly title: string;
  private readonly items: SelectorItem[];
  private filtered: SelectorItem[];
  private readonly multiple: boolean;
  private readonly onSubmit: (items: SelectorItem | SelectorItem[]) => void;
  private readonly onCancel: () => void;
  private readonly requestRender: () => void;
  private readonly input: Input;
  private selectedIndex = 0;
  private readonly checked = new Set<string>();

  constructor(options: {
    title: string;
    items: SelectorItem[];
    multiple?: boolean;
    onSubmit: (items: SelectorItem | SelectorItem[]) => void;
    onCancel: () => void;
    requestRender: () => void;
  }) {
    this.title = options.title;
    this.items = options.items;
    this.filtered = options.items;
    this.multiple = options.multiple ?? false;
    this.onSubmit = options.onSubmit;
    this.onCancel = options.onCancel;
    this.requestRender = options.requestRender;
    this.input = new Input();
  }

  get focused(): boolean { return this.input.focused; }
  set focused(value: boolean) { this.input.focused = value; }
  invalidate(): void { this.input.invalidate(); }

  handleInput(data: string): void {
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

  private toggleCurrent(): void {
    const item = this.filtered[this.selectedIndex];
    if (!item) return;
    if (this.checked.has(item.value)) this.checked.delete(item.value);
    else this.checked.add(item.value);
    this.requestRender();
  }

  render(width: number): string[] {
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
    let index = start;
    for (const item of this.filtered.slice(start, end)) {
      const active = index === this.selectedIndex;
      const marker = this.multiple ? `[${this.checked.has(item.value) ? "x" : " "}] ` : "";
      const prefix = active ? "→ " : "  ";
      const description = item.description ? dim(` · ${item.description}`) : "";
      const line = `${prefix}${marker}${item.label}${description}`;
      lines.push(truncateToWidth(active ? cyan(line) : line, width, ""));
      index++;
    }
    if (this.filtered.length > maxVisible) {
      lines.push(truncateToWidth(dim(`  (${this.selectedIndex + 1}/${this.filtered.length})`), width, ""));
    }
    return lines;
  }
}

type RunSelectorResult = SelectorItem | SelectorItem[] | undefined;

function runSelector(options: {
  title: string;
  items: SelectorItem[];
  multiple: boolean;
}): Promise<RunSelectorResult> {
  requireTerminal("selection");
  if (options.items.length === 0) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    const terminal = new ProcessTerminal();
    const tui = new TuiMainScreen(terminal);
    let finished = false;
    const finish = (value: RunSelectorResult) => {
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

export function selectItem(title: string, items: SelectorItem[]): Promise<SelectorItem | undefined> {
  return runSelector({ title, items, multiple: false }) as Promise<SelectorItem | undefined>;
}

export function selectMany(title: string, items: SelectorItem[]): Promise<SelectorItem[] | undefined> {
  return runSelector({ title, items, multiple: true }) as Promise<SelectorItem[] | undefined>;
}

export function promptText(title: string, initialValue = ""): Promise<string | undefined> {
  requireTerminal("input");
  return new Promise((resolve) => {
    const terminal = new ProcessTerminal();
    const tui = new TuiMainScreen(terminal);
    const input = new Input();
    input.setValue(initialValue);
    let finished = false;
    const finish = (value: string | undefined) => {
      if (finished) return;
      finished = true;
      tui.stop();
      resolve(value);
    };
    input.onSubmit = finish;
    input.onEscape = () => finish(undefined);
    const child: Component & Focusable = {
      invalidate() { input.invalidate(); },
      get focused(): boolean { return input.focused; },
      set focused(value: boolean) { input.focused = value; },
      handleInput(data: string) {
        const kb = getKeybindings();
        if (kb.matches(data, "tui.select.cancel") || kb.matches(data, "tui.input.copy")) {
          finish(undefined);
          return;
        }
        input.handleInput(data);
      },
      render(width: number) {
        return [truncateToWidth(title, width, ""), ...input.render(width)];
      },
    };
    tui.addChild(child);
    tui.setFocus(child);
    tui.start();
  });
}

export function promptCommitMessage(): Promise<string | undefined> {
  requireTerminal("input");
  return new Promise((resolve) => {
    const terminal = new ProcessTerminal();
    const tui = new TuiMainScreen(terminal);
    const editor = new Editor(tui, { borderColor: (text) => text, selectList: editorSelectListTheme });
    let finished = false;
    const finish = (value: string | undefined) => {
      if (finished) return;
      finished = true;
      tui.stop();
      resolve(value);
    };
    editor.onSubmit = finish;
    const child: Component & Focusable = {
      invalidate() { editor.invalidate(); },
      get focused(): boolean { return editor.focused; },
      set focused(value: boolean) { editor.focused = value; },
      handleInput(data: string) {
        const kb = getKeybindings();
        if (kb.matches(data, "tui.select.cancel") || kb.matches(data, "tui.input.copy")) {
          finish(undefined);
          return;
        }
        editor.handleInput(data);
      },
      render(width: number) {
        return [
          truncateToWidth(dim("Commit message · Enter submit · Alt+Enter new line · Esc/Ctrl+C cancel"), width, ""),
          ...editor.render(width),
        ];
      },
    };
    tui.addChild(child);
    tui.setFocus(child);
    tui.start();
  });
}

export async function confirmAction(title: string): Promise<boolean> {
  const selected = await selectItem(title, [
    { value: "yes", label: "Yes" },
    { value: "no", label: "No" },
  ]);
  return selected?.value === "yes";
}

export function isAffirmative(answer: string): boolean {
  return ["y", "yes"].includes(answer.trim().toLowerCase());
}

export async function confirmBranchCreation(name: string): Promise<boolean> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return false;
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await readline.question(`Branch "${name}" does not exist. Create it? [y/N] `);
    return isAffirmative(answer);
  } finally {
    readline.close();
  }
}
