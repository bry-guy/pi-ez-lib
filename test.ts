import test from "node:test";
import assert from "node:assert/strict";
import { CHAT_VM_RESTART_HINT, buildPiChatWorkerCommand, forwardedPiChatWorkerArgs, getPersistedPiChatConversationId, matchSlashCommand, normalizeRemoteCommandText, scheduleCurrentPiChatWorkerRespawn, stripLeadingMention } from "./src/index.js";

test("exports shared restart hint", () => {
  assert.equal(CHAT_VM_RESTART_HINT, "Restart via `/new` for changes to take effect.");
});

test("matches clean and mention-wrapped slash commands", () => {
  assert.equal(stripLeadingMention("  @bot /chat-thread hi"), "/chat-thread hi");
  assert.deepEqual(matchSlashCommand("<@123> /chat-git enable", ["chat-git"]), { name: "chat-git", args: "enable" });
  assert.deepEqual(matchSlashCommand("/chat-git status <@123>", ["chat-git"]), { name: "chat-git", args: "status" });
  assert.equal(matchSlashCommand("@bot hello", ["chat-git"]), undefined);
});

test("matches transcript-shaped Discord forwarded lines", () => {
  assert.deepEqual(matchSlashCommand("- [2026-05-27T15:01:05.371Z] [uid:235246238382030849] prettybry: <@1496161074997624843> /chat-git", ["chat-git"]), { name: "chat-git", args: "" });
  assert.deepEqual(matchSlashCommand("- [2026-05-27T15:01:05.371Z] [uid:235246238382030849] prettybry: /chat-thread foobar <@1496161074997624843>", ["chat-thread"]), { name: "chat-thread", args: "foobar" });
  assert.equal(normalizeRemoteCommandText("- [2026-05-27T15:01:05.371Z] [uid:235246238382030849] prettybry: hello"), "hello");
});

test("multi-line transcripts only consider the latest non-empty line", () => {
  const transcript = [
    "- [2026-05-27T15:01:05.371Z] [uid:235246238382030849] prettybry: <@1496161074997624843> /chat-thread restart",
    "- [2026-05-27T15:01:10.371Z] [uid:235246238382030849] prettybry: <@1496161074997624843> /chat-unmount-all",
    "- [2026-05-27T15:01:12.371Z] [uid:235246238382030849] prettybry: <@1496161074997624843> /chat-thread stop",
  ].join("\n");
  assert.deepEqual(matchSlashCommand(transcript, ["chat-thread"]), { name: "chat-thread", args: "stop" });
  assert.equal(matchSlashCommand(transcript, ["chat-unmount-all"]), undefined);
});

test("older commands do not replay when latest transcript line is not a command", () => {
  const transcript = [
    "- [2026-05-27T15:01:05.371Z] [uid:235246238382030849] prettybry: <@1496161074997624843> /chat-mount pi-ez-delegate",
    "- [2026-05-27T15:01:10.371Z] [uid:235246238382030849] prettybry: <@1496161074997624843> hello",
  ].join("\n");
  assert.equal(matchSlashCommand(transcript, ["chat-mount"]), undefined);
});


test("builds pi-chat worker command while forwarding non-session args", () => {
  const argv = [
    "node",
    "pi",
    "--image",
    "custom",
    "--session",
    "old.jsonl",
    "--session-dir=/old",
    "--chat-conversation",
    "old/convo",
    "-e",
    "/pkg with spaces",
  ];
  assert.deepEqual(forwardedPiChatWorkerArgs(argv), ["--image", "custom", "-e", "/pkg with spaces"]);
  const command = buildPiChatWorkerCommand({ sessionFile: "/tmp/s dir/current.jsonl", conversationId: "acct/channel", argv });
  assert.equal(command.includes("old.jsonl"), false);
  assert.equal(command.includes("--session-dir=/old"), false);
  assert.equal(command, "exec pi '--image' 'custom' '-e' '/pkg with spaces' --session '/tmp/s dir/current.jsonl' --session-dir '/tmp/s dir' --chat-conversation 'acct/channel'");
});

test("schedules robust pi-chat worker respawn", () => {
  const calls: Array<{ command: string; args: readonly string[] }> = [];
  const ctx = {
    cwd: "/repo",
    sessionManager: {
      getSessionFile: () => "/sessions/current.jsonl",
      getEntries: () => [
        { type: "custom", customType: "pi-chat-state", data: { conversationId: "old/channel" } },
        { type: "custom", customType: "pi-chat-state", data: { conversationId: "acct/channel" } },
      ],
    },
  };
  assert.equal(getPersistedPiChatConversationId(ctx), "acct/channel");
  const result = scheduleCurrentPiChatWorkerRespawn(ctx, {
    delaySeconds: 3,
    env: { TMUX_PANE: "%42" },
    argv: ["node", "pi", "--session", "old", "--chat-conversation", "old", "--model", "x"],
    spawn: (command, args) => {
      calls.push({ command, args });
      return { status: 0 };
    },
  });
  assert.deepEqual(result, { scheduled: true, message: "Restarting Gondolin VM and reconnecting pi-chat." });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, "tmux");
  assert.equal(calls[0].args[0], "run-shell");
  assert.equal(calls[0].args[1], "-b");
  const script = String(calls[0].args[2]);
  assert.match(script, /^sleep 3; tmux respawn-pane -k -c '\/repo' -t '%42' /);
  assert.match(script, /exec pi/);
  assert.match(script, /--model/);
  assert.match(script, /current\.jsonl/);
  assert.match(script, /--chat-conversation/);
  assert.match(script, /acct\/channel/);
});

test("respawn helper reports manual restart when worker context is unavailable", () => {
  const result = scheduleCurrentPiChatWorkerRespawn(
    { cwd: "/repo", sessionManager: { getEntries: () => [] } },
    { env: {}, spawn: () => ({ status: 0 }) },
  );
  assert.deepEqual(result, { scheduled: false, message: "Gondolin VM must be restarted." });
});
