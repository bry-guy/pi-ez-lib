# Remote slash-command matching and simplification plan

## Problem

pi-chat sometimes sends extension input hooks a transcript-shaped block, not just the latest Discord message. Previous pi-ez matching logic searched all normalized lines and returned a command if *any* line matched. That causes stale command replay:

- user sends `/chat-thread restart`
- later user sends `/chat-thread stop` or `hello`
- hook receives a multi-line transcript containing both old and new lines
- matcher finds the old command or treats transcript bullets as args
- extension executes the wrong command (`restart` loop) or parses `-` as a flag (`unknown flag: -`)

## Invariant

For remote commands, only the latest non-empty normalized transcript line is eligible for command matching. If the latest line is not a slash command, return `undefined` even if older lines contain slash commands.

This trades away multi-command scanning for correctness. If a user sends multiple slash commands in one Discord message, only the last line is executed. Users should send one command per message.

## Refactor plan

1. Implement latest-line-only matching in `pi-ez-lib`.
2. Add tests covering:
   - previous command + latest `hello` => no command
   - previous command + latest different command => latest command
   - duplicate commands in one block => latest command only
3. Update all pi-ez chat packages to `pi-ez-lib@0.1.5`.
4. Keep package-specific parsing local for now, but remove obvious obsolete wrappers as follow-up:
   - `pi-ez-chat-mount/src/repo-spec.ts` is a backwards-compat test shim and can be deleted once tests use `parseMountTarget` only.
   - Fenced remote-result formatting is duplicated across mount/git/threads; move to `pi-ez-lib` in a later pass.
5. Restart all workers after push so stale loaded matchers are gone.

## Why not scan all commands?

Scanning all commands is fundamentally incompatible with transcript-shaped input. Without a structured event boundary from pi-chat, older commands are indistinguishable from the current command if we scan history. Latest-line-only matches the user's current intent and prevents command replay.
