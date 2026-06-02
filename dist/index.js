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
