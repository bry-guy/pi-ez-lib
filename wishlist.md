# pi / pi-chat / Gondolin upstream wishlist

This file is the single rollup of upstream changes the `pi-ez-*` packages
would like to see in `pi`, `pi-chat` (`@earendil-works/pi-chat`),
`pi-coding-agent`, `pi-tui`, `@earendil-works/gondolin`, and `entireio/cli`.

When a `pi-ez-*` package finds itself reaching for a workaround that touches
upstream internals (monkey-patching `VM.create`, scraping transcripts,
spawning tmux to fake a restart, mutating Gondolin source on disk, etc.),
the entry belongs here. The package itself should keep only a short pointer
back to this file.

Linked downstream:

- `pi-ez-chat-mount/docs/known-issues.md`
- `pi-ez-chat-git/docs/known-issues.md`
- `pi-ez-chat-ssh/src/wrapper.ts` (Gondolin connect-host patch)
- `pi-ez-chat-threads/docs/known-issues.md`
- `pi-ez-chat-workspace/src/apply.ts`
- `pi-ez-worktree/doc/plans/pi-picker-cwd-override-proposal.md`
- `pi-ez-worktree/docs/plans/gondolin-native-worktrees.md`
- `pi-ez-entire/ROADMAP.md`
- `pi-ez-lib/docs/plan-simplify-pi-ez-chat.md`
- `pi-ez-lib/docs/proposal-discord-native-commands.md`
- `pi-ez-lib/docs/plan-remote-command-matching.md`

---

## 1. pi-chat: expose an extension API to restart the current conversation sandbox

**Target:** `@earendil-works/pi-chat`

**2026-06-06 fork status:** `pi-ez-lib` now exposes
`scheduleCurrentPiChatWorkerRespawn()`, a safer tmux workaround that respawns
the current pane with an explicit `pi --session ... --session-dir ...
--chat-conversation ...` command. That preserves the current pi session file
and pi-chat conversation binding across the Gondolin VM restart. Item 3 was
patched in `bry-guy/pi-chat` commit `5237e18` by handling remote `/new`
directly instead of injecting `/chat-new` as a follow-up user message. Items
1 and 2 remain open because the tmux respawn is still a workaround rather
than a first-class in-process VM recreation API.

**Problem.** Several `pi-ez-*` extensions change per-conversation config that
Gondolin only re-reads at `VM.create` time (`pi-ez-chat-mount`,
`pi-ez-chat-git`, `pi-ez-chat-ssh`, `pi-ez-chat-net`,
`pi-ez-chat-workspace`). There is no documented extension API for restarting
the current pi-chat sandbox from inside the VM. Today the workarounds are:

- ask the user to type `@bot /new` in the channel, or
- schedule a tmux pane respawn after the command reply is emitted.

The unsafe historical version called `tmux respawn-pane -k -t $TMUX_PANE`
without an explicit command. That only worked when the pane was originally
spawned by pi-chat's `/chat-spawn-all` worker (`exec pi --session …
--chat-conversation …`). In the main thread, where the user ran `pi`
interactively from a regular shell pane and then `/chat-connect`-ed, bare
`respawn-pane -k` killed the running `pi` process and re-execed the pane's
*original* start command — usually the user's shell — which crashed pi-chat
and disconnected the chat. The current shared workaround avoids that failure
mode by passing tmux an explicit `exec pi ... --session <current>
--chat-conversation <current>` command.

**Ask.**

1. A first-class `ctx.restartConversationSandbox()` (or
   `ConversationSandbox.recreate()`) hook callable by an extension running
   inside the worker.
2. The semantics should be: tear down the current `VM`, re-read
   per-conversation config + extra mounts, and call `VM.create` again with
   the same conversation identity. No tmux involvement.
3. While we are at it: fix `/new` so it actually restarts the worker. Today
   `pi-chat` posts the friendly "Starting a new pi session" reply from the
   host bridge but the actual restart never fires, because
   `pi.sendUserMessage("/chat-new", { deliverAs: "followUp" })` is dispatched
   through `agent-session.prompt(text, { expandPromptTemplates: false,
   source: "extension" })` and `prompt()` only matches extension commands
   when `expandPromptTemplates === true`
   (`pi-coding-agent/dist/core/agent-session.js`). The user-visible symptom
   is that `/new` looks like it worked but the worker keeps its old state.

If only one of the above can land, item 3 is the highest impact: it makes
the existing `@bot /new` workaround actually behave the way every
`pi-ez-chat-*` README claims it does.

**2026-06-03 update: all three in-VM reload paths fail in practice.** During
a live session, every reload mechanism currently shipped failed against the
same worker:

- `@bot /new` — silently does not restart the worker (the `/chat-new` text
  is dropped by `agent-session.prompt` because `expandPromptTemplates:
  false`).
- `/chat-reload` (from `pi-ez-chat-extras`) — throws
  `"This pi runtime does not expose ctx.reload()."` because the optional
  `ctx.reload` hook is undefined on the active pi runtime
  (`pi-ez-chat-extras/src/commands.ts`).
- bare `tmux respawn-pane -k` — removed from `pi-ez-chat-*` because it
  kills the user's pi session in the main pane.

Net effect at the time: extensions had no safe in-VM reload. The current
`pi-ez-lib` helper restores automatic reloads with an explicit respawn
command, but item 1 is still the desired upstream fix because it would avoid
tmux and the post-reply sleep race entirely.

**Source receipts.**

- pi-chat call site: `pi-chat/index.ts` near the `/new` control branch,
  `pi.sendUserMessage("/chat-new", { deliverAs: "followUp" })`.
- Upstream gate that drops the command:
  `pi-coding-agent/dist/core/agent-session.js`'s `prompt(text, options)`
  guarded by `expandPromptTemplates && text.startsWith("/")`.
- Registered command: `pi.registerCommand("chat-new", ...)` in pi-chat's
  `index.ts`.

---

## 2. pi-chat: expose extension contributions to `VM.create` options

**Target:** `@earendil-works/pi-chat`

**Problem.** pi-chat owns the Gondolin VM lifecycle via
`ConversationSandbox` in `pi-chat/src/gondolin.ts` and hard-codes the
options passed to `VM.create`:

```ts
vfs: {
  mounts: {
    [GONDOLIN_WORKSPACE]: new RealFSProvider(workspaceDir),
    [GONDOLIN_SHARED]:    new RealFSProvider(sharedDir),
  },
}
```

pi-chat exposes no extension API for contributing additional VM options.
Extensions do not receive the `VM` instance either. The only reliable hook
point is to wrap `@earendil-works/gondolin`'s `VM.create` static method from
inside the extension before pi-chat calls it. `pi-ez-chat-mount`,
`pi-ez-chat-git`, `pi-ez-chat-ssh`, and `pi-ez-chat-net` all do this today.

This works, but it is fragile in well-defined ways:

- Implicit contract with pi-chat internals (the format of
  `opts.sessionLabel` and the `~/.pi/agent/chat/...` layout that lets us
  identify the conversation from `opts`).
- Implicit contract with Gondolin internals (`VM.create` is a single entry
  point and `opts.vfs.mounts` is a plain mutable object).
- Module identity assumption: pi-chat and the wrapping extension must
  resolve to the same `@earendil-works/gondolin` instance.
- Load order: the extension must register before pi-chat starts its first
  VM.
- Multi-process worker concerns: `/chat-spawn-all` runs each worker in its
  own Node process, so the wrapper must be installed independently in each
  worker.

**Ask.**

1. Extend the per-conversation config schema with structured slots for
   extra mounts, env vars, DNS rules, SSH targets, and TCP egress:
   ```ts
   export interface ExtraMountConfig {
     hostPath: string;
     mode?: "rw" | "ro";
   }
   export interface ConfiguredChannel {
     // existing fields...
     mounts?: Record<string, ExtraMountConfig>; // keyed by guest path
     env?: Record<string, string>;
     ssh?: { hosts: Array<{ alias: string; address: string; user: string; port: number }> };
     tcp?: Record<string, string>; // guest-host[:port] -> upstream-host:port
     allowedHosts?: string[];
   }
   ```
2. Surface them in `ResolvedConversation`.
3. In `src/gondolin.ts`, build `VM.create`'s options from the resolved
   conversation, with validation (skip missing host paths with a logged
   warning, reject guest paths under `/workspace` or `/shared`, etc.).
4. Expose a small extension API for third-party extensions to read and
   write that per-conversation config, and to trigger the restart hook from
   §1.
5. Include `mounts`, `env`, etc. in `/chat-status` output and the
   worker-status JSON, so extensions don't need a side channel to surface
   state.

This is the clean replacement for every `VM.create` wrapper currently
shipped under `pi-ez-chat-*`. If it lands we delete those wrappers and the
extensions just write the per-conversation config.

---

## 3. pi-chat: structured remote command channel (no transcript parsing)

**Target:** `@earendil-works/pi-chat` (+ optional Discord gateway adapter)

**Problem.** Today extensions detect remote slash commands by parsing the
transcript text pi-chat passes to their `input` hook. That is brittle
because:

- pi-chat may send transcript-shaped multi-line blocks, not just the latest
  Discord message, so older commands can replay.
- Commands must tolerate bot mentions, transcript prefixes
  (`- [time] [uid:...] user:`), code fences, and Discord message edits.
- LLM turn timing is coupled to command parsing.
- The current "post-then-restart" pattern races against the worker
  lifecycle.

`pi-ez-lib` mitigates this with latest-line-only matching (see
`docs/plan-remote-command-matching.md` and `docs/plan-simplify-pi-ez-chat.md`),
but the underlying invariant — "commands come in over a text channel that
also carries free-form chat" — should not be the extension's problem.

**Ask.** A structured command dispatch surface in pi-chat that extensions
register against. Two acceptable shapes:

1. **In-band structured event.** pi-chat normalizes Discord interactions
   and forwards them as a typed event (`{ command, options, conversation,
   discord }`) to a dedicated `pi.on("remote-command", ...)` hook,
   bypassing the transcript text path.
2. **Out-of-band Discord application commands.** pi-chat registers (or
   collaborates with) a Discord command gateway that owns
   `/pi-thread`/`/pi-mount`/`/pi-git`/etc. application commands and hands
   each invocation to the conversation's worker over a local RPC channel.
   See `pi-ez-lib/docs/proposal-discord-native-commands.md` for the full
   design.

Either shape gives us: no transcript parsing, no accidental replay, native
Discord validation/autocomplete, and a clean place to gate worker restarts
on interaction acknowledgement.

---

## 4. Gondolin: keep a `connectHost` / `connectPort` on normalized SSH credentials

**Target:** `@earendil-works/gondolin` (currently ~0.75)

**Problem.** Gondolin's SSH proxy can authenticate on behalf of the guest,
but its normalized credential object does not preserve a separate upstream
connect host/port. `pi-ez-chat-ssh/src/wrapper.ts` therefore ships a tiny,
idempotent runtime patch that adds `connectHost` / `connectPort` to two
files inside Gondolin's installed `dist/`:

- `node_modules/@earendil-works/gondolin/dist/ssh/utils.js`
- `node_modules/@earendil-works/gondolin/dist/qemu/ssh.js`

The patch is documented in code as "keep this compatibility patch tiny and
idempotent until upstream exposes this as a stable option."

**Ask.** Add `connectHost?: string` and `connectPort?: number` (or a single
`connect?: { host: string; port?: number }`) to Gondolin's normalized SSH
credential type, and honor them in the QEMU SSH connect path. Once that
lands, `pi-ez-chat-ssh` deletes its disk-patcher.

---

## 5. Gondolin: clarify and (ideally) enforce read-only mounts

**Target:** `@earendil-works/gondolin`

**Problem.** `pi-ez-chat-mount` accepts `--read-only` but treats it as
best-effort. It is not confirmed whether Gondolin's `RealFSProvider` honors
a read-only flag end-to-end.

**Ask.** Either:

1. Document and enforce read-only as a first-class `RealFSProvider` option,
   or expose a `ReadonlyProvider` that wraps another provider, with
   read-only semantics guaranteed at the VM filesystem layer, or
2. State explicitly that `RealFSProvider` is always rw and tell us to
   enforce read-only at the VM layer (remount-ro inside the guest).

Today we conservatively wrap with `ReadonlyProvider` when available, but we
do not promise the guest cannot write. A clear contract here lets us
promise correctly.

---

## 6. pi-chat: queue the wake-up message when a dormant worker is restarted

**Target:** `@earendil-works/pi-chat`

**Problem.** `pi-ez-chat-threads`'s parent-channel supervisor wakes a
dormant thread worker when a new user message lands in the thread. pi-chat
catches up missed Discord messages before arming the runtime for new jobs,
so the message that woke the worker is logged but **not queued as an agent
turn**. The supervisor currently has to post a follow-up asking the user to
resend their request.

**Ask.** Either:

1. Let pi-chat start from a specific Discord wake-up message id, or
2. Intentionally queue the latest catch-up trigger as an agent turn after
   wake-up.

We deliberately do not fake this by injecting tmux keystrokes or mutating
pi-chat's private job queue.

---

## 7. pi-chat threads: native thread lifecycle on top of pi-chat conversations

**Target:** `@earendil-works/pi-chat`

**Problem.** `pi-ez-chat-threads` does not extend pi-chat's session/VM
model. A "thread" is mechanically just another pi-chat conversation
(`<accountId>/<channelKey>`) registered in `~/.pi/agent/chat/config.json`
with extra metadata (`managedBy: "pi-ez-chat-threads"`,
`parentConversationId`). The extension layers on top:

- Discord thread creation,
- mount inheritance at fork time (via
  `~/.pi/agent/chat-mount/mounts.json`),
- a fork of the parent's pi session into the thread's worker session
  directory,
- a lifecycle catalog at `~/.pi/agent/chat-threads/threads.json`.

This is a lot of cross-package coordination for a feature that is really a
pi-chat concept.

**Ask.** First-class threads in pi-chat: a parent conversation can spawn a
named child conversation that inherits per-conversation config from the
parent at creation, and pi-chat owns the catalog and lifecycle (start,
stop, restart, rename, kill, list). With §1 + §2 + §3 in place, this is
mostly a config-copy + lifecycle command surface; without them it requires
deep coupling across `pi-ez-chat-mount`, `pi-ez-chat-threads`, and
pi-chat.

---

## 8. pi: allow extensions to override the cwd used by the `@` file picker

**Target:** `pi` / `pi-coding-agent` / `pi-tui`

**Problem.** pi roots the built-in `@` file picker / path autocomplete at
`process.cwd()` (interactive mode constructs
`CombinedAutocompleteProvider(..., process.cwd(), fdPath)` in
`pi-coding-agent/dist/modes/interactive/interactive-mode.js`; `pi-tui`'s
`CombinedAutocompleteProvider` takes a `basePath` that defaults to
`process.cwd()`).

That works for normal sessions but blocks extensions that change the
session's effective project root at runtime, such as `pi-ez-worktree`:
after attaching to a worktree, tool calls and bash are redirected into it,
but the picker still suggests files from the original checkout.

**Ask.** Add an extension hook or API that lets an extension provide the
effective cwd/root for the built-in picker and `@file` resolution:

- default behavior unchanged when no extension overrides,
- override can change during a live session (after
  `/wt-start`/`/wt-attach`/`/wt-detach`),
- ideally the same override applies to final `@file` path resolution so
  suggestions and resolution stay aligned.

Full draft of the proposed upstream issue lives in
`pi-ez-worktree/doc/plans/pi-picker-cwd-override-proposal.md`.

---

## 9. pi-chat: surface a way to delegate tool calls into Gondolin from an extension

**Target:** `@earendil-works/pi-chat`

**Problem.** `pi-ez-worktree` wants a "Gondolin-native worktree" mode where
the worker starts a delegate VM, runs work inside it, and returns a patch
artifact to the parent. Today there is no clean way for a third-party
extension to detect that its sibling pi-chat extension is delegating tool
calls into Gondolin, nor a stable way to participate in that delegation
without coupling to pi-chat internals.

**Ask.** A small, documented surface that lets an extension:

1. Detect whether the current session has tool-call delegation into
   Gondolin active.
2. Open / close a delegate VM scoped to a specific task.
3. Return a result (patch, files, exit code) to the parent.

See `pi-ez-worktree/docs/plans/gondolin-native-worktrees.md` for context.

---

## 10. `entireio/cli`: merge the `pi` agent adapter

**Target:** [`entireio/cli`](https://github.com/entireio/cli)

**Problem.** `pi-ez-entire` is the pi-side half of the Entire integration.
The matching Go agent adapter is implemented in a local fork
(`~/dev/entireio/entire-cli`, branch `feat/pi-agent-adapter`) and is ready
for dogfooding + upstream PR.

**Ask.** Merge the `pi` adapter into `entireio/cli` so `entire enable
--agent pi` is supported upstream and `pi-ez-entire` can be published to
npm. Full status, file layout, and reference points are in
`pi-ez-entire/ROADMAP.md`.

---

---

## 11. (resolved downstream) `/chat-compact` fire-and-forget hang/crash

**Status:** root cause was in `pi-ez-chat-extras`, not pi-chat. Patched in
`pi-ez-chat-extras/src/commands.ts` (`runChatCompact`) on 2026-06-05.
Receipt kept here because the symptom looked like a pi-chat bridge bug, and
because the broader bridge-state-machine concern (compaction events outside
the prompt → `agent_end` flow) is still real and worth tracking.

**Symptoms observed (2026-06-03 and 2026-06-05).**

- Parent Discord channel: `/chat-compact` succeeded (context dropped from
  15.7% to 6.5% per `/chat-status`), worker stayed up, but the Discord
  bridge stayed in "@bot is typing..." forever and no further messages were
  ever dispatched. Recovery required killing the worker tmux session
  host-side.
- Thread worker (managed by `pi-ez-chat-threads`): `/chat-compact`
  terminated the worker tmux session entirely. `pi-ez-chat-threads`
  detected the dead worker on the next `/chat-thread` invocation
  (`worker: restarted (...)`).

**Root cause.** `pi-ez-chat-extras/src/commands.ts` defined
`runChatCompact` as:

```ts
ctx.compact({ ...callbacks });
return { message: "Compaction started." };
```

i.e. fire-and-forget. `ctx.compact` is `void`-returning by the pi-runtime
contract (see `pi-ez-chat-extras/src/pi-types.ts`), so without manually
waiting on `onComplete`/`onError` the extension command resolved
immediately. The Discord bridge therefore:

- received the "Compaction started." message at T+0 but no terminating
  `agent_end` event, so it left typing/prompt-lock state asserted; and
- if compaction later threw and `onError` couldn't keep up (or the runtime
  surfaced an unhandled rejection in strict mode), the worker process
  exited.

**Fix shape (applied downstream).** Wrap the callback API in a Promise so
the command resolves only after compaction actually completes or errors,
and surface errors as a normal `CommandResult` instead of `ctx.ui.notify`:

```ts
return await new Promise<CommandResult>((resolve) => {
  let settled = false;
  const finish = (r: CommandResult) => { if (!settled) { settled = true; resolve(r); } };
  try {
    ctx.compact!({
      customInstructions: args.trim() || undefined,
      onComplete: () => finish({ message: "Compaction completed." }),
      onError: (e) => finish({ level: "error", message: `Compaction failed: ${e.message}` }),
    });
  } catch (e) {
    finish({ level: "error", message: `Compaction failed to start: ${String(e)}` });
  }
});
```

**2026-06-05 fork status:** `bry-guy/pi-chat` commit `5237e18` adds a
small bridge-side mitigation for the built-in remote `/compact` control
path: pi-chat now wraps `ctx.compact(...)` in a Promise, reports sync
startup failures, and resolves after `onComplete`, `onError`, or a
90-second `PI_CHAT_COMPACT_WATCHDOG_MS` timeout. This does not add a
generic chat-turn watchdog, because long software-work turns can validly
run longer than 90 seconds and should not be failed by the bridge.

**Still upstream-relevant.** Even with the downstream and fork fixes,
pi-chat's bridge still relies on `agent_end` as the canonical "release
typing + prompt-lock" signal for normal prompted work. Any future
extension that legitimately performs long-running non-prompt work
(compaction wrappers, branch summary, deferred sandbox recreates) could
trip the same shape of bug. A bridge-side guard should be targeted to
known non-prompt operations or be based on operation-specific lifecycle
events, not a short generic turn timeout.


## Filing notes

- One upstream issue per top-level numbered item is fine; they are roughly
  independent and have different owners.
- Items §1–§3 are the highest leverage for the `pi-ez-chat-*` family
  because they collectively let us delete every `VM.create` wrapper and
  every transcript-parsing input hook.
- Item §4 is the smallest and most mechanical — a good warm-up PR if we
  want to upstream-something-quickly.
- Items §8–§10 are owned by different repos and can be filed in parallel.
