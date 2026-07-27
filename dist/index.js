import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
export const CHAT_VM_RESTART_HINT = "Restart via `/new` for changes to take effect.";
const mentionPattern = String.raw `(?:<@!?\d+>|<@&\d+>|@[\w.-]+)`;
const leadingMentionPattern = new RegExp(String.raw `^${mentionPattern}\s*`, "u");
const trailingMentionPattern = new RegExp(String.raw `\s*${mentionPattern}\s*$`, "u");
export function stripLeadingMention(text) {
    let rest = text.trimStart();
    while (true) {
        const next = rest.replace(leadingMentionPattern, "");
        if (next === rest)
            return rest;
        rest = next.trimStart();
    }
}
export function stripTrailingMention(text) {
    let rest = text.trimEnd();
    while (true) {
        const next = rest.replace(trailingMentionPattern, "").trimEnd();
        if (next === rest)
            return rest;
        rest = next;
    }
}
export function stripTranscriptPrefix(text) {
    return text.trimStart().replace(/^-?\s*(?:\[[^\]\r\n]+\]\s*){1,3}[^:\r\n]{1,120}:\s*/u, "");
}
export function normalizeRemoteCommandText(text) {
    return stripTrailingMention(stripLeadingMention(stripTranscriptPrefix(text))).trim();
}
function candidatesFor(text) {
    // pi-chat may hand extensions a transcript-shaped block, not just the latest
    // Discord message. Older slash commands in that block must not replay on later
    // non-command turns. Therefore, for multi-line input only the latest non-empty
    // normalized line is eligible for command matching.
    const pieces = /\r?\n/u.test(text) ? text.split(/\r?\n/u) : [text];
    const normalized = pieces.map(normalizeRemoteCommandText).filter(Boolean);
    const latest = normalized.at(-1);
    return latest ? [latest] : [];
}
export function matchSlashCommand(text, aliases) {
    for (const stripped of candidatesFor(text)) {
        for (const alias of aliases) {
            const command = `/${alias}`;
            if (stripped === command)
                return { name: alias, args: "" };
            if (stripped.startsWith(`${command} `) || stripped.startsWith(`${command}\n`) || stripped.startsWith(`${command}\t`)) {
                return { name: alias, args: stripTrailingMention(stripped.slice(command.length).trim()) };
            }
        }
    }
    return undefined;
}
function defaultSpawn() {
    return spawnSync;
}
export function getPersistedPiChatConversationId(ctx) {
    const entries = ctx.sessionManager.getEntries?.() ?? [];
    for (let index = entries.length - 1; index >= 0; index--) {
        const entry = entries[index];
        if (entry.type !== "custom" || entry.customType !== "pi-chat-state")
            continue;
        const conversationId = entry.data?.conversationId;
        if (typeof conversationId === "string" && conversationId.trim())
            return conversationId;
        return undefined;
    }
    return undefined;
}
function shellQuote(value) {
    return `'${value.replace(/'/g, `'"'"'`)}'`;
}
const REPLACED_PI_CHAT_VALUE_FLAGS = new Set(["--session", "--session-dir", "--chat-conversation"]);
const REPLACED_PI_CHAT_PREFIX_FLAGS = ["--session=", "--session-dir=", "--chat-conversation="];
export function forwardedPiChatWorkerArgs(argv = process.argv) {
    const raw = argv.slice(2);
    const out = [];
    for (let i = 0; i < raw.length; i++) {
        const arg = raw[i];
        if (REPLACED_PI_CHAT_VALUE_FLAGS.has(arg)) {
            i++;
            continue;
        }
        if (REPLACED_PI_CHAT_PREFIX_FLAGS.some((prefix) => arg.startsWith(prefix)))
            continue;
        out.push(arg);
    }
    return out;
}
export function buildPiChatWorkerCommand(params) {
    const sessionDir = params.sessionDir ?? dirname(params.sessionFile);
    return [
        "exec pi",
        ...forwardedPiChatWorkerArgs(params.argv).map(shellQuote),
        "--session",
        shellQuote(params.sessionFile),
        "--session-dir",
        shellQuote(sessionDir),
        "--chat-conversation",
        shellQuote(params.conversationId),
    ].join(" ");
}
export function scheduleCurrentPiChatWorkerRespawn(ctx, options = {}) {
    const env = options.env ?? process.env;
    const pane = env.TMUX_PANE;
    if (!pane)
        return { scheduled: false, message: "Gondolin VM must be restarted." };
    const sessionFile = ctx.sessionManager.getSessionFile?.();
    if (!sessionFile)
        return { scheduled: false, message: "Gondolin VM must be restarted. Auto-restart failed: no current pi session file." };
    const conversationId = getPersistedPiChatConversationId(ctx);
    if (!conversationId)
        return { scheduled: false, message: "Gondolin VM must be restarted. Auto-restart failed: no pi-chat conversation binding." };
    const cwd = ctx.cwd?.trim() || process.cwd();
    const delay = Math.max(1, options.delaySeconds ?? 3);
    const command = buildPiChatWorkerCommand({ sessionFile, conversationId, argv: options.argv });
    const script = `sleep ${delay}; tmux respawn-pane -k -c ${shellQuote(cwd)} -t ${shellQuote(pane)} ${shellQuote(command)}`;
    const spawn = options.spawn ?? defaultSpawn();
    const result = spawn("tmux", ["run-shell", "-b", script], { encoding: "utf8", env });
    if (result.error || result.status !== 0) {
        const stderr = typeof result.stderr === "string" ? result.stderr.trim() : result.stderr?.toString().trim();
        return {
            scheduled: false,
            message: `Gondolin VM must be restarted. Auto-restart failed: ${stderr || result.error?.message || `tmux exited ${result.status}`}`,
        };
    }
    return { scheduled: true, message: "Restarting Gondolin VM and reconnecting pi-chat." };
}
