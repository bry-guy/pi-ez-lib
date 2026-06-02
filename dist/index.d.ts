export type CommandMatch = {
    name: string;
    args: string;
};
export declare const CHAT_VM_RESTART_HINT = "Restart via `/new` for changes to take effect.";
export declare function stripLeadingMention(text: string): string;
export declare function stripTrailingMention(text: string): string;
export declare function stripTranscriptPrefix(text: string): string;
export declare function normalizeRemoteCommandText(text: string): string;
export declare function matchSlashCommand(text: string, aliases: readonly string[]): CommandMatch | undefined;
