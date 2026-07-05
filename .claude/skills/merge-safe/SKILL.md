---
name: merge-safe
description: >
  Blocking checklist run AFTER resolving any rebase/merge conflict and BEFORE
  the first `git add`. Auto-fire this any time `<<<<<<<` appeared in a diff
  during the session, or right after `git rebase` / `git merge` / `git
  cherry-pick` reported conflicts. Prevents two proven blow-ups: committing
  literal conflict markers into history, and silently keeping a pre-rename
  symbol on a line adjacent to the other side's independent rename. Use when
  the user says "resolve conflicts", "finish the rebase/merge", "stage the
  resolution", or you are about to `git add` after a conflict.
---

# merge-safe

Conflict resolution is NOT done until every step below passes. Run them in
order. Do NOT `git add` anything until step 4.

## 1. No unmerged paths remain

```
git diff --name-only --diff-filter=U
```

Must print NOTHING. Any path listed = still unmerged. Resolve it, rerun.

## 2. No conflict markers left in touched files

```
git diff --name-only --diff-filter=M HEAD | tr '\n' '\0' | \
  xargs -0 grep -nE '^(<{7}|={7}|>{7})( |$)' 2>/dev/null
```

Must print NOTHING. If it prints lines, those are unresolved markers — fix
them, rerun.

NEVER verify remaining markers with `tail`/`head` — they truncate the list and
manufacture false confidence. A committed `<<<<<<<` triggered a full hard reset
and ~1h lost, twice. Grep the WHOLE set or nothing.

## 3. Silent-adjacent-rename check

Read BOTH sides' commit messages for rename / "→" / "rename" / "renamed"
language:

```
git log --format='%s%n%b' HEAD@{1}..HEAD 2>/dev/null    # or the two merged tips
```

If either side renamed a symbol, field, route, or wire-key, grep the touched
files for the OTHER side's PRE-rename name. Auto-merge keeps a stale name on a
line next to the other side's rename — compiles clean, wrong. Grep to zero.

## 4. Stage by explicit filename ONLY

```
git add path/to/resolved-file.ts   # name each file
```

NEVER `git add -A` / `git add .` after a conflict — blindly stages markers and
unintended changes.

## Only now

Steps 1–3 green + staging explicit → run tsc / targeted tests, then commit.
