# Proposal: Discord-native pi / pi-ez commands

## Problem

Text slash commands inside pi-chat messages are brittle because pi-chat may forward transcript-shaped history into extension input hooks. Even with latest-line-only parsing, text commands remain coupled to mentions, transcript formatting, LLM turn timing, and worker restarts.

## Goal

Move pi-chat and pi-ez operations to first-class Discord application commands while still using pi workers under the hood.

## Proposed architecture

1. **Discord command gateway**
   - A small Discord bot process owns application commands (`/pi-thread start`, `/pi-mount`, `/pi-git`, etc.).
   - Discord sends structured interaction payloads: command name, options, user, channel, thread, guild.
   - No transcript parsing.

2. **Local command RPC**
   - Gateway calls a local pi command service over a Unix socket or HTTP-on-localhost.
   - Request shape:
     ```json
     {
       "command": "chat-mount",
       "conversationId": "discord-bry-guy/test2-841803",
       "options": { "target": "pi-ez-delegate" },
       "discord": { "channelId": "...", "interactionToken": "..." }
     }
     ```
   - Response shape:
     ```json
     { "ok": true, "body": "...", "restartWorker": true }
     ```

3. **Command handlers become pure functions**
   - pi-ez packages expose command functions (`chatMount`, `threadStart`, `threadKill`, etc.) that accept structured options and return structured results.
   - The current pi extension layer becomes just one adapter.
   - The Discord gateway becomes another adapter.

4. **Discord interaction responses**
   - Gateway immediately acknowledges interactions (`deferReply`).
   - Command output is posted as a fenced code block via Discord's interaction follow-up API.
   - Worker restarts happen after follow-up is confirmed, eliminating response/restart races.

5. **Worker lifecycle authority**
   - Thread commands can still use `pi-ez-chat-threads` catalog and tmux management.
   - Channel-worker commands can respawn the worker by conversation id using the same tmux naming convention.
   - This should eventually move into pi-chat upstream as a supported worker-control API.

## Command surface sketch

```text
/pi-mount target:pi-ez-delegate read_only:false
/pi-unmount target:pi-ez-delegate
/pi-unmount-all
/pi-mounts

/pi-thread start name:test2
/pi-thread stop name:test2
/pi-thread restart name:test2
/pi-thread rename target:test2 name:"new name"
/pi-thread kill target:test2
/pi-thread list

/pi-git enable
/pi-git identity value:"Bry Guy <bry@example.com>"
/pi-git status
```

## Migration path

1. Refactor pi-ez command implementations into structured core functions while keeping existing text commands.
2. Add a local RPC command service loaded by pi or run as a sidecar.
3. Build/register Discord application commands.
4. Route Discord commands to the local RPC service.
5. Keep text commands as fallback/debug for a while.
6. If accepted upstream, move generic command gateway + worker lifecycle into pi-chat.

## Benefits

- No transcript parsing.
- No accidental command replay.
- Native Discord validation and autocomplete.
- Better permission model per command.
- Reliable interaction acknowledgements before worker restarts.
- Cleaner separation between command execution and agent conversation voice.

## Open questions

- Should the gateway live in pi-chat upstream or as `pi-ez-discord-commands` first?
- Should it run as a persistent sidecar or inside each worker process?
- How should local RPC authenticate? Unix socket permissions may be enough on single-user machines.
- How much autocomplete do we want (thread names, repo names from source dir, mount names)?
