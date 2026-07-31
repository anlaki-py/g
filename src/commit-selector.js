import {
  fuzzyFilter,
  getKeybindings,
  Input,
  ProcessTerminal,
  truncateToWidth,
  TuiMainScreen,
} from "../tui/dist/index.js";

const cyan = (text) => `\x1b[36m${text}\x1b[39m`;
const dim = (text) => `\x1b[2m${text}\x1b[22m`;

export function getCommitSearchText(commit) {
  return `${commit.hash} ${commit.shortHash} ${commit.subject} ${commit.author} ${commit.date}`;
}

export function filterCommits(commits, query) {
  return fuzzyFilter(commits, query, getCommitSearchText);
}

export class CommitRangeSelector {
  constructor(commits, onSelect, onCancel, requestRender) {
    this.commits = commits;
    this.filtered = commits;
    this.onSelect = onSelect;
    this.onCancel = onCancel;
    this.requestRender = requestRender;
    this.search = new Input();
    this.selectedIndex = 0;
    this.first = undefined;
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
        this.filtered = this.commits.filter((commit) => commit.hash !== selected.hash);
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
      const available = this.first
        ? this.commits.filter((commit) => commit.hash !== this.first.hash)
        : this.commits;
      this.filtered = filterCommits(available, query);
      this.selectedIndex = 0;
      this.requestRender();
    }
  }

  render(width) {
    const lines = [];
    const heading = this.first
      ? `Select newer commit · from ${cyan(this.first.shortHash)} ${this.first.subject}`
      : "Select older commit";
    lines.push(truncateToWidth(heading, width, ""));
    lines.push(truncateToWidth(dim("Search by hash, message, author, or date · Esc to cancel"), width, ""));
    lines.push(...this.search.render(width));

    if (this.filtered.length === 0) {
      lines.push(truncateToWidth(dim("  No matching commits"), width, ""));
      return lines;
    }

    const maxVisible = 10;
    const start = Math.max(0, Math.min(
      this.selectedIndex - Math.floor(maxVisible / 2),
      this.filtered.length - maxVisible,
    ));
    const end = Math.min(start + maxVisible, this.filtered.length);
    for (let i = start; i < end; i++) {
      const commit = this.filtered[i];
      const prefix = i === this.selectedIndex ? cyan("→ ") : "  ";
      const text = `${commit.shortHash} ${commit.subject} ${dim(`· ${commit.author} · ${commit.date}`)}`;
      lines.push(truncateToWidth(prefix + (i === this.selectedIndex ? cyan(text) : text), width, ""));
    }
    if (this.filtered.length > maxVisible) {
      lines.push(truncateToWidth(dim(`  (${this.selectedIndex + 1}/${this.filtered.length})`), width, ""));
    }
    return lines;
  }
}

export function selectCommitRange(commits) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("commit selection requires an interactive terminal");
  }
  if (commits.length < 2) {
    throw new Error("at least two commits are required");
  }

  return new Promise((resolve) => {
    const terminal = new ProcessTerminal();
    const tui = new TuiMainScreen(terminal);
    let finished = false;
    const finish = (range) => {
      if (finished) return;
      finished = true;
      tui.stop();
      resolve(range);
    };
    const selector = new CommitRangeSelector(commits, finish, () => finish(undefined), () => tui.requestRender());
    tui.addChild(selector);
    tui.setFocus(selector);
    tui.start();
  });
}
