# Workspace Page Density Design

Date: 2026-05-26

## Goal

Redesign the firmware Workspace page so it answers four questions at a glance:

1. Which repository, directory, and branch am I working in?
2. Is the working tree clean or dirty?
3. How many files and lines changed?
4. What are the most important changed files right now?

The shared top header is out of scope. This design covers only the page body below
the common model/status header.

## Current Behavior

The Workspace page currently renders:

- branch name and ahead/behind counts
- full workspace path
- line add/remove counts from the Claude Code statusLine cost payload
- staged, unstaged, and untracked counts
- latest commit hash and message

This underuses the 320x240 screen. It also mixes two different concepts:

- Claude session line counts, which describe what Claude has done in the current
  session
- git working tree changes, which describe the current repository state

For a Workspace page, git working tree data should be the source of truth for
file and line change summaries.

## Product Direction

Use a combined snapshot + change-detail layout.

The page should show a compact workspace snapshot at the top and a current-change
summary below it. When there are local changes, the lower section shows the top
changed files. When the tree is clean, the lower section shows recent commit
context instead.

### Clean State

```text
main                         clean  ^0 v0
m5toys                       /playground/m5toys

Files      0 staged   0 modified   0 new
Lines      +0         -0
Status     no local changes

2314b8b    Merge fix/screenshot-host-encode
```

### Dirty State

```text
feat/workspace-ui            dirty  ^2 v0
m5toys                       /playground/m5toys

Files      2 staged   5 modified   1 new
Lines      +128       -24
Top        pages.cpp         +84 / -12
           status_model.h    +18 / -0
           git-enrich.ts     +26 / -12
```

## Information Architecture

### Row 1: Branch And State

Left: branch name.

Right: compact state and ahead/behind counts.

State rules:

- `dirty`: staged + unstaged + untracked > 0
- `clean`: staged + unstaged + untracked == 0
- `behind`: use warning color when behind > 0
- `^N vM`: render at the top right after the clean/dirty state

If horizontal space is constrained, preserve branch and state before
ahead/behind.

### Row 2: Repository And Path

Left: repository/worktree name.

Right: shortened parent path or relative workspace path.

Do not render the full absolute path by default. It is too expensive on a small
screen and usually repeats low-value home-directory segments.

Suggested shortening:

- repo name: basename of the git root, or basename of workspace dir if git root
  is unavailable
- path hint: last two meaningful path segments, prefixed with `/`

Example:

```text
m5toys                       /playground/m5toys
```

### Rows 3-5: Change Summary

Render labels and values instead of compact codes.

```text
Files      2 staged   5 modified   1 new
Lines      +128       -24
Status     uncommitted changes
```

The existing `staged`, `unstaged`, and `untracked` values remain useful. The
`Lines` row should come from git diff stats, not Claude statusLine cost fields.

### Bottom Section: Contextual Detail

If dirty:

- show up to three top changed files
- each row includes a shortened path and `+added / -removed`
- sort by total line churn descending

If clean:

- show latest commit hash and message
- include age if available, because recency is more useful than hash alone

Example:

```text
12m        2314b8b    Merge fix/screenshot-host-encode
```

## Data Model

Extend `StatusPayload.git` with optional diff summary fields:

```ts
git: {
  branch?: string
  ahead?: number
  behind?: number
  staged?: number
  unstaged?: number
  untracked?: number
  lastCommit?: {
    hash?: string
    msg?: string
    minsAgo?: number
  }
  diff?: {
    filesChanged?: number
    linesAdded?: number
    linesRemoved?: number
    topFiles?: Array<{
      path: string
      added: number
      removed: number
    }>
  }
}
```

`diff` is optional so older daemons and non-git directories continue to degrade
gracefully.

## Daemon Data Flow

`GitEnricher.enrich()` should compute diff stats alongside existing branch,
status, ahead/behind, and last commit fields.

Recommended commands:

```bash
git diff --numstat
git diff --cached --numstat
```

The daemon should merge staged and unstaged numstat rows by path.

Rules:

- count text-file additions and removals from `--numstat`
- treat binary rows (`- - path`) as changed files with 0 added and 0 removed
- do not read untracked file contents for line stats
- include untracked files in the `Files` row through the existing `untracked`
  count
- cap `topFiles` to three entries before sending to firmware
- preserve the existing git cache behavior so statusLine ticks do not run git too
  often

## Firmware Model

Extend `StatusModel` with:

```cpp
bool hasDiff = false;
int diffFilesChanged = 0;
int diffLinesAdded = 0;
int diffLinesRemoved = 0;
int topFileN = 0;
struct TopFile {
  char path[40];
  int added;
  int removed;
} topFiles[3];
```

Parsing rules:

- set `hasDiff` only when `git.diff` is present
- clamp `topFiles` to three entries
- truncate paths safely with null termination
- keep existing behavior when `git.diff` is missing

## Firmware Rendering

Update only the Workspace page body.

The page should avoid large empty vertical gaps and use consistent row spacing.
The existing common header and page dots remain unchanged.

Suggested y positions after header:

- `42`: branch, state, ahead/behind
- `62`: repo/path hint
- `82`: hairline
- `92`: Files row
- `112`: Lines row
- `132`: Status row or first detail row
- `154`, `176`, `198`: top changed files or commit context

Rendering fallbacks:

- no git: show workspace directory and dash placeholder, as today
- git present but no diff: show staged/modified/untracked and use Claude
  session line counts only if no git diff line counts are available
- clean: show latest commit context
- dirty with no top files: show `uncommitted changes`

## Visual Priority

Use stronger visual weight for:

- branch
- `dirty` or `clean`
- line totals

Use muted color for:

- path hints
- `^N vM`
- row labels
- commit hash

Use warning color only for actionable risk:

- behind > 0
- dirty state

## Testing

Protocol tests:

- accept `git.diff` with `filesChanged`, `linesAdded`, `linesRemoved`, and
  `topFiles`
- preserve compatibility when `git.diff` is absent

Daemon tests:

- parse staged and unstaged `--numstat`
- merge duplicate paths from staged and unstaged diffs
- handle binary file rows
- leave untracked line counts out of diff totals
- sort and cap top files

Firmware model tests:

- parse `git.diff`
- truncate and cap top files
- degrade when `git.diff` is missing

Firmware page tests:

- dirty workspace renders `dirty`, file counts, line counts, and top files
- clean workspace renders `clean` and latest commit context
- no-git workspace still renders the existing fallback without crashing

## Non-Goals

- Do not change the shared header.
- Do not add new pages.
- Do not add scrolling.
- Do not read untracked file contents to calculate line counts.
- Do not implement a full commit history list in this pass.

## Truncation Rules

Use deterministic tail-preserving truncation for long strings:

- branch: max 28 visible characters, keep the end and prefix with `...`
- repo name: max 18 visible characters, keep the start and suffix with `...`
- path hint: max 24 visible characters, keep the end and prefix with `...`
- top file path: max 22 visible characters, keep the end and prefix with `...`
- commit message: render only the prefix that fits after age and hash

Do not truncate numeric values. If a row cannot fit both text and numbers, keep
the numbers and truncate the text.
