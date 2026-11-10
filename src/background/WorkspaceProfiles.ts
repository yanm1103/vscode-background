import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import vscode from 'vscode';

import { writeFileAtomic } from '../utils/atomicFile';
import { ENCODING } from '../utils/constants';
import type { TPatchGeneratorConfig } from './PatchGenerator';

/**
 * Settings that can be overridden per workspace.
 */
export const CONFIG_KEYS = ['enabled', 'editor', 'sidebar', 'auxiliarybar', 'panel', 'fullscreen'] as const;

export type TConfigKey = (typeof CONFIG_KEYS)[number];

export type TWorkspaceOverrides = Partial<TPatchGeneratorConfig>;

type TProfileEntry = {
    /** Workspace key, see toWorkspaceKey */
    key: string;
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
 *
 * One file per project: each window only writes the file of its own project,
 * so windows saving at the same time cannot lose each other's changes.
 */
export class WorkspaceProfiles {
    private migrated = false;

    /**
     * @param dirPath folder with one json file per project
     * @param legacyFilePath single file with every project, used before. Moved into `dirPath` on first use.
     */
    constructor(
        private dirPath: string,
        private legacyFilePath: string
    ) {}

    private fileOf(key: string) {
        // keys are uris, hash them into a valid file name
        const name = crypto.createHash('sha1').update(key).digest('hex').slice(0, 16);
        return path.join(this.dirPath, `${name}.json`);
    }

    private readEntry(filePath: string): TProfileEntry | undefined {
        try {
            const data = JSON.parse(fs.readFileSync(filePath, ENCODING));
            return isPlainObject(data) && typeof data.key === 'string' && isPlainObject(data.overrides)
                ? (data as TProfileEntry)
                : undefined;
        } catch {
            return undefined;
        }
    }

    private writeEntry(entry: TProfileEntry) {
        fs.mkdirSync(this.dirPath, { recursive: true });
        writeFileAtomic(this.fileOf(entry.key), JSON.stringify(entry, null, 4));
    }

    /**
     * Copies the profiles of the legacy file that are not stored yet, then removes it.
     * Safe to run in several windows at once: they all copy the same entries.
     */
    private migrate() {
        if (this.migrated) {
            return;
        }
        this.migrated = true;
        try {
            if (!fs.existsSync(this.legacyFilePath)) {
                return;
            }
            const data = JSON.parse(fs.readFileSync(this.legacyFilePath, ENCODING));
            for (const [key, entry] of Object.entries(isPlainObject(data) ? data : {})) {
                if (isPlainObject(entry?.overrides) && !fs.existsSync(this.fileOf(key))) {
                    this.writeEntry({ key, fsPath: entry.fsPath, overrides: entry.overrides });
                }
            }
            fs.rmSync(this.legacyFilePath, { force: true });
        } catch {
            // file busy or unreadable, try again on the next use
            this.migrated = false;
        }
    }

    private listFiles() {
        try {
            return (
                fs
                    .readdirSync(this.dirPath)
                    .filter(name => name.endsWith('.json'))
                    // same order in every window, so they all write the same state
                    .sort()
                    .map(name => path.join(this.dirPath, name))
            );
        } catch {
            return [];
        }
    }

    public read(): Record<string, TProfileEntry> {
        this.migrate();
        const profiles: Record<string, TProfileEntry> = {};
        for (const filePath of this.listFiles()) {
            const entry = this.readEntry(filePath);
            if (entry) {
                profiles[entry.key] = entry;
            }
        }
        return profiles;
    }

    /**
     * Saves (or removes, when empty) the overrides of a workspace.
     *
     * @returns whether the stored profiles changed
     */
    public set(key: string, fsPath: string | undefined, overrides: TWorkspaceOverrides): boolean {
        this.migrate();
        const filePath = this.fileOf(key);
        const prev = this.readEntry(filePath);

        if (!Object.keys(overrides).length) {
            if (!prev) {
                return false;
            }
            fs.rmSync(filePath, { force: true });
            return true;
        }

        const next: TProfileEntry = { key, fsPath, overrides };
        if (JSON.stringify(prev) === JSON.stringify(next)) {
            return false;
        }
        this.writeEntry(next);
        return true;
    }

    /**
     * Profiles merged on top of the global config. Projects whose folder was deleted are dropped.
     */
    public resolve(globalConfig: TPatchGeneratorConfig): Record<string, TPatchGeneratorConfig> {
        const result: Record<string, TPatchGeneratorConfig> = {};

        for (const [key, entry] of Object.entries(this.read())) {
            if (entry.fsPath && !fs.existsSync(entry.fsPath)) {
                try {
                    fs.rmSync(this.fileOf(key), { force: true });
                } catch {}
                continue;
            }
            result[key] = mergeConfig(globalConfig, entry.overrides);
        }

        return result;
    }
}
