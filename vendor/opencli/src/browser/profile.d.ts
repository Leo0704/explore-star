export declare const DEFAULT_CONTEXT_ID = "default";
export type ProfileConfig = {
    version: 1;
    defaultContextId?: string;
    aliases: Record<string, string>;
};
export declare function normalizeContextId(value: string | undefined | null): string | undefined;
export declare function emptyProfileConfig(): ProfileConfig;
export declare function loadProfileConfig(): ProfileConfig;
export declare function saveProfileConfig(config: ProfileConfig): void;
export declare function resolveProfileContextId(profile?: string): string | undefined;
export declare function aliasForContextId(config: ProfileConfig, contextId: string): string | undefined;
export declare function renameProfile(contextId: string, alias: string): ProfileConfig;
export declare function setDefaultProfile(profile: string): ProfileConfig;
