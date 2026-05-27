import test from "node:test";
import assert from "node:assert/strict";
import { matchSlashCommand, normalizeRemoteCommandText, stripLeadingMention } from "./src/index.js";

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
