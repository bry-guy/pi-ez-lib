import test from "node:test";
import assert from "node:assert/strict";
import { CHAT_VM_RESTART_HINT, matchSlashCommand, normalizeRemoteCommandText, stripLeadingMention } from "./src/index.js";

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
