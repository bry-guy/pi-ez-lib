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
export type PiChatSessionContext = {
    cwd?: string;
    sessionManager: {
        getEntries?(): unknown[];
        getSessionFile?(): string | undefined;
    };
};
export type RestartScheduleResult = {
    scheduled: boolean;
    message: string;
};
export type WorkerSpawnOptions = {
    stdio?: unknown;
    encoding?: BufferEncoding;
    env?: NodeJS.ProcessEnv;
};
export type WorkerSpawn = (command: string, args: readonly string[], options?: WorkerSpawnOptions) => {
    status: number | null;
    stderr?: string | Buffer;
    error?: Error;
};
export type PiChatWorkerRespawnOptions = {
    delaySeconds?: number;
    argv?: readonly string[];
    env?: NodeJS.ProcessEnv;
    spawn?: WorkerSpawn;
};
export declare function getPersistedPiChatConversationId(ctx: {
    sessionManager: {
        getEntries?(): unknown[];
    };
}): string | undefined;
export declare function forwardedPiChatWorkerArgs(argv?: readonly string[]): string[];
export declare function buildPiChatWorkerCommand(params: {
    sessionFile: string;
    sessionDir?: string;
    conversationId: string;
    argv?: readonly string[];
}): string;
export declare function scheduleCurrentPiChatWorkerRespawn(ctx: PiChatSessionContext, options?: PiChatWorkerRespawnOptions): RestartScheduleResult;
