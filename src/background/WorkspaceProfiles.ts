import fs from 'node:fs';
import path from 'node:path';

import vscode from 'vscode';

import { ENCODING } from '../utils/constants';
import type { TPatchGeneratorConfig } from './PatchGenerator';

/**
 * Settings that can be overridden per workspace.
 */
export const CONFIG_KEYS = ['enabled', 'editor', 'sidebar', 'auxiliarybar', 'panel', 'fullscreen'] as const;

export type TConfigKey = (typeof CONFIG_KEYS)[number];

export type TWorkspaceOverrides = Partial<TPatchGeneratorConfig>;

type TProfileEntry = {
    /** Local folder or .code-workspace file, used to drop profiles of projects that no longer exist. */
    fsPath?: string;
    overrides: TWorkspaceOverrides;
};

type TUriLike = { scheme: string; authority?: string; path: string };

/**
 * Builds the key that identifies a workspace.
 * The injected script builds the same key in the renderer (see PatchGenerator), keep both in sync.
 */
export function toWorkspaceKey(uri: TUriLike) {
    return `${uri.scheme}://${uri.authority ?? ''}${uri.path}`.toLowerCase();
}

/**
 * Key of the workspace open in this window, or `undefined` for empty / untitled windows.
 */
export function getCurrentWorkspace(): { key: string; fsPath?: string } | undefined {
    const file = vscode.workspace.workspaceFile;
    const uri = file ?? vscode.workspace.workspaceFolders?.[0]?.uri;

    // untitled multi-root workspaces have no stable path
    if (!uri || uri.scheme === 'untitled') {
        return undefined;
    }

    return {
        key: toWorkspaceKey(uri),
        fsPath: uri.scheme === 'file' ? uri.fsPath : undefined
    };
}

function isPlainObject(value: unknown): value is Record<string, any> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Deep merge like VS Code does for object settings across scopes: objects merge, everything else replaces.
 */
export function mergeConfig<T>(base: T, override: unknown): T {
    if (!isPlainObject(base) || !isPlainObject(override)) {
        return (override === undefined ? base : override) as T;
    }

    const result: Record<string, any> = { ...base };
    for (const [key, value] of Object.entries(override)) {
        result[key] = mergeConfig(result[key], value);
    }
    return result as T;
}

/**
 * Stores the workspace overrides of every project opened so far,
 * so a single patch can carry a background for each of them.
 */
export class WorkspaceProfiles {
    constructor(private filePath: string) {}

    public read(): Record<string, TProfileEntry> {
        try {
            const data = JSON.parse(fs.readFileSync(this.filePath, ENCODING));
            return isPlainObject(data) ? data : {};
        } catch {
            return {};
        }
    }

    private write(profiles: Record<string, TProfileEntry>) {
        fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
        fs.writeFileSync(this.filePath, JSON.stringify(profiles, null, 4), ENCODING);
    }

    /**
     * Saves (or removes, when empty) the overrides of a workspace.
     *
     * @returns whether the stored profiles changed
     */
    public set(key: string, fsPath: string | undefined, overrides: TWorkspaceOverrides): boolean {
        const profiles = this.read();
        const hasOverrides = Object.keys(overrides).length > 0;
        const prev = profiles[key];

        if (!hasOverrides) {
            if (!prev) {
                return false;
            }
            delete profiles[key];
        } else {
            const next: TProfileEntry = { fsPath, overrides };
            if (JSON.stringify(prev) === JSON.stringify(next)) {
                return false;
            }
            profiles[key] = next;
        }

        this.write(profiles);
        return true;
    }

    /**
     * Profiles merged on top of the global config. Projects whose folder was deleted are dropped.
     */
    public resolve(globalConfig: TPatchGeneratorConfig): Record<string, TPatchGeneratorConfig> {
        const profiles = this.read();
        const result: Record<string, TPatchGeneratorConfig> = {};
        let pruned = false;

        for (const [key, entry] of Object.entries(profiles)) {
            if (entry.fsPath && !fs.existsSync(entry.fsPath)) {
                delete profiles[key];
                pruned = true;
                continue;
            }
            result[key] = mergeConfig(globalConfig, entry.overrides);
        }

        if (pruned) {
            try {
                this.write(profiles);
            } catch {}
        }

        return result;
    }

    public clear() {
        this.write({});
    }
}
