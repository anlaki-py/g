import {
  decodeKittyPrintable,
  Key,
  matchesKey,
  ProcessTerminal,
  stripTerminalSequences,
  truncateToWidth,
  TuiAltScreen,
  type Component,
} from "../tui/dist/index.js";
import { renderDiff } from "./diff-renderer.ts";

const dim = (text: string): string => `\x1b[2m${text}\x1b[22m`;

export type DiffViewportHost = {
  terminal: { rows: number };
  requestRender(): void;
};

export class DiffViewport implements Component {
  private readonly tui: DiffViewportHost;
  private readonly allLines: string[];
  private readonly title: string;
  private readonly onClose: () => void;
  lines: string[];
  offset = 0;
  query = "";

  constructor(tui: DiffViewportHost, patch: string, title: string, onClose: () => void) {
    this.tui = tui;
    this.allLines = (patch.includes("diff --git ") ? renderDiff(patch) : patch).split("\n");
    this.lines = this.allLines;
    this.title = title;
    this.onClose = onClose;
    this.offset = 0;
    this.query = "";
  }

  invalidate(): void {}

  getPageSize(): number {
    return Math.max(1, this.tui.terminal.rows - 2);
  }

  scrollBy(lines: number): void {
    const maxOffset = Math.max(0, this.lines.length - this.getPageSize());
    this.offset = Math.max(0, Math.min(maxOffset, this.offset + lines));
    this.tui.requestRender();
  }

  updateFilter(query: string): void {
    this.query = query;
    const normalized = query.toLowerCase();
    this.lines = normalized
      ? this.allLines.filter((line) => stripTerminalSequences(line).toLowerCase().includes(normalized))
      : this.allLines;
    this.offset = 0;
    this.tui.requestRender();
  }

  handleInput(data: string): void {
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
        return code < 32 || code === 0x7f || (code >= 0x80 && code <= 0x9f);
      });
      const printable = kittyPrintable ?? (hasControlCharacters ? "" : data);
      if (printable) this.updateFilter(this.query + printable);
    }
  }

  render(width: number): string[] {
    const pageSize = this.getPageSize();
    const end = Math.min(this.lines.length, this.offset + pageSize);
    const position = this.lines.length > pageSize
      ? ` · ${this.offset + 1}-${end}/${this.lines.length}`
      : ` · ${this.lines.length}/${this.allLines.length}`;
    const filter = this.query ? `Filter: ${this.query}` : "Type to filter";
    const output = [
      truncateToWidth(this.title, width, ""),
      truncateToWidth(dim(`${filter} · PgUp/PgDn or ↑/↓ to scroll · Esc to close${position}`), width, ""),
    ];
    for (let i = this.offset; i < end; i++) {
      output.push(truncateToWidth(this.lines[i] ?? "", width, ""));
    }
    return output;
  }
}

export function showDiff(patch: string, title = "Git diff"): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("diff display requires an interactive terminal");
  }

  return new Promise((resolve) => {
    const terminal = new ProcessTerminal();
    const tui = new TuiAltScreen(terminal, undefined, undefined, { mouse: false });
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
