# g

A small shortcut for common Git commands. It supports switching between local branches with a terminal UI and creating commits.

## Install locally

Requires Node.js 22.19 or newer and Git.

```sh
npm install
npm link
```

This exposes the `g` command globally for the current Node.js installation.

## Usage

Show every available command:

```sh
g h
g -h
g --help
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

Create a commit from staged changes with either command:

```sh
g c "describe the change"
g commit "describe the change"
```

If the message is omitted, `g` uses `new commit`:

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

Show the repository status with either command:

```sh
g s
g status
```

Show staged, unstaged, and untracked changes in a colored, scrollable diff viewer:

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

Every shortcut forwards additional arguments to its Git command:

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
