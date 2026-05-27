export type CommandMatch = {
    name: string;
    args: string;
};
export declare function stripLeadingMention(text: string): string;
export declare function stripTrailingMention(text: string): string;
export declare function stripTranscriptPrefix(text: string): string;
export declare function normalizeRemoteCommandText(text: string): string;
export declare function matchSlashCommand(text: string, aliases: readonly string[]): CommandMatch | undefined;
