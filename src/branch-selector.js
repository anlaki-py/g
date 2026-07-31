import {
  ProcessTerminal,
  SelectList,
  Text,
  TuiMainScreen,
} from "../tui/dist/index.js";

const cyan = (text) => `\x1b[36m${text}\x1b[39m`;
const dim = (text) => `\x1b[2m${text}\x1b[22m`;
const theme = {
  selectedPrefix: cyan,
  selectedText: cyan,
  description: dim,
  scrollInfo: dim,
  noMatch: dim,
};

export function selectBranch(branches) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("branch selection requires an interactive terminal");
  }

  return new Promise((resolve) => {
    const terminal = new ProcessTerminal();
    const tui = new TuiMainScreen(terminal);
    const items = branches.map((branch) => ({
      value: branch.name,
      label: branch.name,
      description: branch.current ? "current" : undefined,
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
    list.onCancel = () => finish(undefined);

    tui.addChild(new Text("Select a branch", 0, 0));
    tui.addChild(list);
    tui.setFocus(list);
    tui.start();
  });
}
