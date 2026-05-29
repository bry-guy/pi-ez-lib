# pi-ez chat extension simplification audit

## Scope audited

- `pi-ez-lib`
- `pi-ez-chat-threads`
- `pi-ez-chat-mount`
- `pi-ez-chat-git`

## Findings

### 1. Remote command matching was the root complexity hotspot

The old matcher tried to be helpful by scanning all lines in a transcript-shaped payload. That created command replay and `unknown flag: -` failures. The simpler invariant is now: **only the latest non-empty normalized transcript line can be a command**.

This removes the need for package-specific defenses against transcript bullets in parsers.

### 2. Response delivery and worker restart were coupled incorrectly

`pi-ez-chat-mount` changed config then asked the worker to restart. If the response depended on the same worker surviving long enough for an LLM transform reply, the user could see no response or a stale later response. The simpler behavior is now: changed mount/unmount commands post their fenced result directly to Discord before scheduling the worker respawn.

### 3. Keep tests, but stop testing obsolete compatibility shims

`pi-ez-chat-threads` has many assertions because the package owns lifecycle, persistence, Discord API shape, session forking, and worker tmux behavior. The count is not the problem; the redundant compatibility shim in mount was. Removed `src/repo-spec.ts` and its tests in favor of `parseMountTarget`.

### 4. Remaining duplication that is acceptable for now

- Fenced remote-response prompts exist in mount/git/threads. They are tiny and package-specific enough to keep until the command surface stabilizes.
- Each package has its own local command parser. That is intentional: their flags and verbs differ.

### 5. Future cleanup candidates

- Move fenced-response prompt builders into `pi-ez-lib` once the direct-Discord response path is proven stable.
- Split `pi-ez-chat-threads/index.ts` into `parser.ts`, `lifecycle.ts`, and `remote.ts` if it grows further. Do not split just for aesthetics; keep transactional lifecycle code together until `kill`/`rename` settle.
- Add an upstream pi-chat structured command hook to avoid transcript parsing entirely.

## Implemented in this pass

- `pi-ez-lib`: latest-line-only matching for transcript-shaped input.
- `pi-ez-chat-mount`: direct Discord result delivery before auto-restart; removed obsolete repo-spec shim.
- `pi-ez-chat-threads`, `pi-ez-chat-mount`, `pi-ez-chat-git`: bumped to `pi-ez-lib@0.1.5`.
