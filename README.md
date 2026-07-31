# g

A hobbyist Git helper built to reduce everyday friction while keeping you in control. It adds searchable terminal interfaces and short commands for common workflows without hiding the Git operations being performed.

> **Hobbyist project:** `g` is a personal convenience tool, not professional or production-grade Git tooling. Review prompts and diffs before confirming operations, and use regular Git whenever you need its full precision and guarantees.

## Install

Requires Node.js 22.19 or newer and Git.

Install directly from GitHub without cloning:

```sh
npm install --global https://github.com/anlaki-py/g/releases/latest/download/git-shortcut-tui.tgz
```

The same command works on Linux, macOS, and Windows (quote the URL in PowerShell or Windows Terminal). The URL points at the latest release, which is created automatically whenever source code is pushed: tests run, the version bumps, and a tagged GitHub Release with the packaged tarball is generated.

### Try it without installing

Don't want to commit to an install yet? `npx` can download and run the same tarball on the fly — nothing is installed on your system:

```sh
npx -y https://github.com/anlaki-py/g/releases/latest/download/git-shortcut-tui.tgz h
```

Replace `h` with any command (`s` for status, `d` for diff, `c "message"` to commit, …). The first run downloads the tarball into npx's cache; later runs are instant. Note that `npx git-shortcut-tui` does not work — the package is not published to the npm registry, only as GitHub release tarballs. Interactive commands (`b`, `stage`, `c` without a message) require a terminal, so run `npx` from an interactive shell rather than a pipe.

> **Upgrading from an earlier install:** if you installed `g` before releases existed, run `npm uninstall --global git-shortcut-tui` once before installing from the release URL above. The npm installation creates the Windows `g.cmd` launcher automatically. Windows x64 and ARM64 console helpers are included in the package. The test workflow runs on both Ubuntu and Windows for every push and pull request.

### Local development

```sh
npm install
npm run check   # type check (tsc --noEmit) + lint (ESLint)
npm test
npm link
```

This exposes the `g` command globally for the current Node.js installation. The project is written in TypeScript. During development, `src/`, `test/`, and `bin/` run directly as `.ts` via Node.js native type stripping (22.18+), so there is no compile step for day-to-day work — `tsc` is used only for type checking and ESLint enforces style. New code must pass both (`npm run check`). The published package ships a compiled bundle (`dist/g.js`, built by `npm run build`) because Node does not allow type stripping for files under `node_modules`.

## Usage

Show every available command:

```sh
g h
g -h
g --help
```

Show the version:

```sh
g v
g -v
g --version
```

From inside a Git repository, run either:

```sh
g b
g branch
```

Use Up/Down to move, Enter to switch branches, and Escape or Ctrl+C to cancel. To switch directly without opening the selector, provide the branch name:

```sh
g b feature/login
g branch feature/login
```

If the named branch does not exist, `g` asks whether to create it with `[y/N]`; pressing Enter defaults to no.

Create a commit from staged changes with either command:

```sh
g c "describe the change"
g commit "describe the change"
```

Without a message, `g c` opens a prompt: type your message and press Enter to commit, Alt+Enter inserts a new line, and Escape or Ctrl+C cancels without committing.

```sh
g c
```

Stage all changes with either command:

```sh
g a
g add
```

Both default to `git add .`. You can also provide specific paths:

```sh
g add src README.md
```

Interactively select files and individual hunks to stage:

```sh
g stage
g a -p
```

Type to filter, use Space or Tab to toggle changes, and press Enter to stage the selection.

Show the repository status with either command:

```sh
g s
g status
```

Show staged, unstaged, and untracked changes with colored rendering. Small diffs print inline; larger diffs open the scrollable viewer:

```sh
g d
g diff
```

Use `g diff -b` or `g diff -between` to search the commit history, select two commits, and view the difference between them. Search matches commit hashes, messages, authors, and dates.

```sh
g diff -b
g diff -between
```

Use Up/Down to select commits, Enter to confirm each commit, and Escape or Ctrl+C to cancel. In the diff viewer, type to filter lines, use Backspace to edit the filter, scroll with PageUp/PageDown or Up/Down, and close with Escape or Ctrl+C.

Search commit history and preview any commit:

```sh
g l
g log
g log --all
```

Manage stashes interactively, or forward a native stash command:

```sh
g stash
g stash list
```

Safely undo the latest commit while keeping its changes staged:

```sh
g undo
```

Navigate unresolved conflicts, preview them, and open files in `$GIT_EDITOR`, `$VISUAL`, `$EDITOR`, or `vi`:

```sh
g conflicts
```

Select untracked paths to remove. Interactive clean requires typing `DELETE` before anything is deleted:

```sh
g clean
```

Select a pull/push action, remote, and branch:

```sh
g remote
```

Initialize a Git repository:

```sh
g i
g init
```

Pull or push the current branch:

```sh
g pull
g push
```

## Git arguments

Direct shortcuts forward additional arguments to Git. `stash`, `clean`, and `remote` open their TUI with no arguments and forward explicit arguments directly:

```sh
g s --short
g a --dry-run .
g c --amend --no-edit
g b --detach HEAD~1
g diff --stat
g i --bare
g pull --rebase origin main
g push --force-with-lease origin main
```

For `g c`, text without an option is treated as the commit message. Use normal Git options such as `-m`, `--amend`, or `--no-edit` when you need full `git commit` behavior.

To unlink it later:

```sh
npm unlink -g git-shortcut-tui
```
