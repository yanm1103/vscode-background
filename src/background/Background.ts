import fs from 'node:fs';
import path from 'node:path';

import vscode, { type Disposable, l10n } from 'vscode';

import { _ } from '../utils';
import { writeFileAtomic } from '../utils/atomicFile';
import { DATA_DIR, ENCODING, EXT_ROOT, EXTENSION_NAME, TOUCH_FILE_PATH, VERSION } from '../utils/constants';
import { getLegacyJsPath, getWorkbenchHtmlPath } from '../utils/patchTargets';
import { vsHelp } from '../utils/vsHelp';
import { EFilePatchType, HtmlPatchFile, JsPatchFile } from './PatchFile';
import { getImageFolders, PatchGenerator, type TPatchGeneratorConfig } from './PatchGenerator';
import {
    CONFIG_KEYS,
    getCurrentWorkspace,
    mergeConfig,
    type TWorkspaceOverrides,
    WorkspaceProfiles
} from './WorkspaceProfiles';

/**
 * 配置类型
 */
type TConfigType = vscode.WorkspaceConfiguration & TPatchGeneratorConfig;

/**
 * 插件逻辑类
 * Extension logic
 *
 * @export
 * @class Background
 */
export class Background implements Disposable {
    // #region fields 字段

    public htmlFile = new HtmlPatchFile(getWorkbenchHtmlPath());

    private legacyJsFile = new JsPatchFile(getLegacyJsPath());

    /** Workspace overrides of every project, shared by all windows */
    private profiles = new WorkspaceProfiles(
        path.join(DATA_DIR, 'profiles'),
        path.join(DATA_DIR, 'workspace-profiles.json')
    );

    /** Watchers of the image folders this window draws, a new or removed image rewrites the state */
    private folderWatchers: Disposable[] = [];

    private refreshTimer?: NodeJS.Timeout;

    /**
     * Backgrounds of every window, polled by the patch for live updates.
     * Saved as `.svg` because windows may only read files outside VS Code's folders when they are images.
     */
    private stateFilePath = path.join(DATA_DIR, 'state.svg');

    /**
     * Desktop windows read the state file, so settings apply without reloading.
     * code-server cannot read it, there the state is embedded in the patch.
     */
    private liveUpdate = _.isDesktop;

    /**
     * Current config
     * 当前用户配置
     *
     * @private
     * @type {TConfigType}
     * @memberof Background
     */
    public get config() {
        return vscode.workspace.getConfiguration('background') as TConfigType;
    }

    /**
     * 需要释放的资源
     *
     * @private
     * @type {Disposable[]}
     * @memberof Background
     */
    private disposables: Disposable[] = [];

    /**
     * User (global) config, without the values of the workspace open in this window.
     * It is the background of every project that has no override.
     */
    public get globalConfig(): TPatchGeneratorConfig {
        const config = this.config;
        const result: Record<string, unknown> = {};
        for (const key of CONFIG_KEYS) {
            const info = config.inspect(key);
            result[key] = mergeConfig(info?.defaultValue, info?.globalValue);
        }
        return result as TPatchGeneratorConfig;
    }

    /**
     * Values set in the workspace open in this window (`.vscode/settings.json` or `.code-workspace`).
     */
    private get workspaceOverrides(): TWorkspaceOverrides {
        const config = this.config;
        const result: Record<string, unknown> = {};
        for (const key of CONFIG_KEYS) {
            const value = config.inspect(key)?.workspaceValue;
            if (value !== undefined) {
                result[key] = value;
            }
        }
        return result as TWorkspaceOverrides;
    }

    // #endregion

    // #region private methods 私有方法

    /**
     * Saves the overrides of the workspace open in this window.
     */
    private syncWorkspaceProfile() {
        const workspace = getCurrentWorkspace();
        if (!workspace) {
            return;
        }
        try {
            this.profiles.set(workspace.key, workspace.fsPath, this.workspaceOverrides);
        } catch {}
    }

    private createState() {
        const globalConfig = this.globalConfig;
        return PatchGenerator.createState(globalConfig, this.profiles.resolve(globalConfig));
    }

    /**
     * Writes the state file, open windows pick it up within a couple of seconds.
     */
    private writeState() {
        if (!this.liveUpdate) {
            return;
        }
        try {
            fs.mkdirSync(DATA_DIR, { recursive: true });
            // another window may save its profile while this one builds the state and then
            // get its newer state overwritten, so check the profiles again after writing
            for (let pass = 0; pass < 2; pass++) {
                const profiles = JSON.stringify(this.profiles.read());
                const content = JSON.stringify(this.createState());
                // skip identical writes, every window writes on config changes
                if (this.readStateFile() !== content) {
                    writeFileAtomic(this.stateFilePath, content);
                }
                if (JSON.stringify(this.profiles.read()) === profiles) {
                    return;
                }
            }
        } catch {}
    }

    private readStateFile() {
        try {
            return fs.readFileSync(this.stateFilePath, ENCODING);
        } catch {
            return undefined;
        }
    }

    private disposeFolderWatchers() {
        clearTimeout(this.refreshTimer);
        this.folderWatchers.forEach(n => n.dispose());
        this.folderWatchers = [];
    }

    /**
     * Image folders are expanded to their files when the state is written, so watch the ones
     * this window draws. Folders of other projects are watched by their own windows.
     */
    private watchImageFolders() {
        this.disposeFolderWatchers();

        const globalConfig = this.globalConfig;
        // same config the window draws: the profile of its workspace, or the global one
        const config = getCurrentWorkspace() ? mergeConfig(globalConfig, this.workspaceOverrides) : globalConfig;
        if (!this.liveUpdate || !globalConfig.enabled || config.enabled === false) {
            return;
        }

        const folders = new Set(
            [config.editor, config.sidebar, config.auxiliarybar, config.panel, config.fullscreen]
                .flatMap(section => getImageFolders(section?.images))
                // `file://` and relative folders are not found by the glob either
                .filter(folder => path.isAbsolute(folder))
                .map(folder => path.normalize(folder).replace(/[\\/]+$/, ''))
        );

        // many events (copying a folder) end in a single write, after the last file is complete
        const refresh = () => {
            clearTimeout(this.refreshTimer);
            this.refreshTimer = setTimeout(() => this.writeState(), 1000);
        };

        try {
            for (const folder of folders) {
                // VS Code's watcher is recursive on every platform and waits for folders that do not exist yet
                const watcher = vscode.workspace.createFileSystemWatcher(
                    new vscode.RelativePattern(vscode.Uri.file(folder), '**/*')
                );
                watcher.onDidCreate(refresh);
                watcher.onDidChange(refresh);
                watcher.onDidDelete(refresh);
                this.folderWatchers.push(watcher);
            }
        } catch {}
    }

    private createPatch() {
        if (this.liveUpdate) {
            return PatchGenerator.create({ stateUrl: _.toVscodeFileUrl(this.stateFilePath) });
        }
        return PatchGenerator.create({ initialState: this.createState() });
    }

    /**
     * Whether workbench.html already holds the current patch.
     */
    private async isPatchUpToDate() {
        try {
            const [content, patch] = await Promise.all([this.htmlFile.getContent(), this.createPatch()]);
            return content.includes(`<script>${patch}</script>`);
        } catch {
            return true;
        }
    }

    private async removeLegacyJsPatch() {
        try {
            const hasPatched = await this.legacyJsFile.hasPatched();
            if (!hasPatched) {
                return;
            }

            await this.legacyJsFile.restore();
        } catch {}
    }

    /**
     * 检测是否初次加载
     *
     * @private
     * @returns {boolean} 是否初次加载
     * @memberof Background
     */
    private async checkFirstload(): Promise<boolean> {
        const firstLoad = !fs.existsSync(TOUCH_FILE_PATH);

        if (firstLoad) {
            await fs.promises.writeFile(TOUCH_FILE_PATH, this.htmlFile.filePath, ENCODING);
            return true;
        }

        return false;
    }

    public async showWelcome() {
        // 欢迎页
        const docDir = path.join(EXT_ROOT, 'docs');
        const docName = vscode.env.language.startsWith('zh') ? 'welcome.zh-CN.md' : 'welcome.md';

        // welcome 内容
        let content = await fs.promises.readFile(path.join(docDir, docName), ENCODING);
        // 替换图片内联为base64
        content = content.replace(/\.\.\/images[^")]+/g, (relativePath: string) => {
            const imgPath = path.join(EXT_ROOT, 'images', relativePath);

            return (
                `data:image/${path.extname(imgPath).slice(1) || 'png'};base64,` +
                Buffer.from(fs.readFileSync(imgPath)).toString('base64')
            );
        });
        // 替换变量
        const paramsMap = {
            VERSION
        };
        for (const [key, value] of Object.entries(paramsMap)) {
            content = content.replaceAll('${' + key + '}', value);
        }
        vsHelp.showMarkdown(content, 'welcome');
    }

    /**
     * 配置改变，confirm 并提示应用&重启
     *
     * @private
     * @return {*}
     * @memberof Background
     */
    private async onConfigChange() {
        this.syncWorkspaceProfile();
        // live update: open windows redraw from the new state (or clear it when disabled)
        this.writeState();
        this.watchImageFolders();

        const hasInstalled = await this.hasInstalled();
        // global switch, a workspace can only turn its own background off
        const enabled = this.globalConfig.enabled;

        // 禁用
        if (!enabled) {
            if (!hasInstalled) {
                return;
            }
            // the empty state already cleared the background, the patch only has to leave workbench.html
            if (this.liveUpdate) {
                await this.uninstall();
                return;
            }
            vsHelp.reload({
                message: l10n.t('Background will be disabled.'),
                btnReload: l10n.t('Disable and Reload'),
                beforeReload: () => this.uninstall()
            });
            return;
        }

        // the patch already reads the state file, nothing to reload
        if (this.liveUpdate && hasInstalled && (await this.isPatchUpToDate())) {
            return;
        }

        // 更新，需要二次确认
        vsHelp.reload({
            message: l10n.t('Configuration has been changed, click to apply.'),
            btnReload: l10n.t('Apply and Reload'),
            beforeReload: () => this.applyPatch()
        });
    }

    public async applyPatch() {
        this.syncWorkspaceProfile();
        this.writeState();

        if (!this.globalConfig.enabled) {
            return true;
        }

        const scriptContent = await this.createPatch();
        return this.htmlFile.applyPatches(scriptContent);
    }

    /**
     * Applies the patch.
     *
     * @returns whether the window has to be reloaded to run it, `false` when it is already running
     * or could not be written
     */
    public async install(): Promise<boolean> {
        const upToDate = this.liveUpdate && (await this.hasInstalled()) && (await this.isPatchUpToDate());
        const patchApplied = await this.applyPatch();
        return patchApplied !== false && !upToDate;
    }

    /**
     * Writes starting `background.*` settings to the project open in this window
     * (`.vscode/settings.json` or the `.code-workspace`, created by VS Code when missing) and opens the file.
     */
    public async addProjectSettings() {
        if (!vscode.workspace.workspaceFolders?.length) {
            vscode.window.showWarningMessage(l10n.t('Open a folder or workspace first.'));
            return;
        }

        const section = await vscode.window.showQuickPick(
            ['fullscreen', 'editor', 'sidebar', 'panel', 'auxiliarybar'],
            {
                placeHolder: l10n.t('Which part of the window gets the background?')
            }
        );
        if (!section) {
            return;
        }

        const config = this.config;
        const info = config.inspect<Record<string, unknown>>(section);
        if (info?.workspaceValue !== undefined) {
            // keep what the project already has, just show it
            vscode.window.showInformationMessage(
                l10n.t('This project already has `background.{section}` settings.', { section })
            );
        } else {
            const picked = await vscode.window.showOpenDialog({
                title: l10n.t('Select the images (cancel to leave the list empty)'),
                canSelectMany: true,
                filters: { Images: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'] }
            });
            const images = (picked ?? []).map(uri => uri.fsPath.replace(/\\/g, '/'));
            // every option with its default, so they are all there to be edited
            await config.update(
                section,
                { style: {}, ...info?.defaultValue, images },
                vscode.ConfigurationTarget.Workspace
            );
        }

        await vscode.commands.executeCommand('workbench.action.openWorkspaceSettingsFile');
    }

    public async previewPatch() {
        this.syncWorkspaceProfile();
        const scriptContent = await this.createPatch();
        const state = JSON.stringify(this.createState(), null, 2);
        vsHelp.showMarkdown(
            '```ts\n' + scriptContent + '\n```\n\nState:\n\n```json\n' + state + '\n```',
            'preview-patch'
        );
    }

    // #endregion

    // #region public methods

    /**
     * 初始化
     *
     * @memberof Background
     */
    public async setup(): Promise<void> {
        await this.removeLegacyJsPatch();

        await this.checkFirstload();

        this.syncWorkspaceProfile();
        this.writeState();
        this.watchImageFolders();

        const patchType = await this.htmlFile.getPatchType();

        // 如果「开启」状态，文件不是「latest」，则进行「提示更新」
        // 此时一般为 「background更新」、「vscode更新」
        const needApply = [EFilePatchType.Legacy, EFilePatchType.None].includes(patchType);
        // the patch is from this version but outdated. Without live update it lacks this project's
        // background (first time opened, or settings edited while closed)
        const profileOutdated = this.globalConfig.enabled && !needApply && !(await this.isPatchUpToDate());

        if (this.globalConfig.enabled && (needApply || profileOutdated)) {
            // 提示
            vscode.window
                .showInformationMessage(
                    profileOutdated && !this.liveUpdate
                        ? l10n.t('Background settings changed. Apply to take effect.')
                        : l10n.t('Background@{version} is ready! Apply to take effect.', { version: VERSION }),
                    {
                        title: l10n.t('Apply and Reload'),
                        action: async () => {
                            const patchApplied = await this.applyPatch();
                            if (patchApplied !== false) {
                                await vsHelp.reload();
                            }
                        }
                    },
                    {
                        title: l10n.t('More'),
                        action: () => this.showWelcome()
                    }
                )
                .then(confirm => {
                    confirm?.action();
                });
        }

        // 监听文件改变
        this.disposables.push(
            vscode.workspace.onDidChangeConfiguration(async ex => {
                const hasChanged = ex.affectsConfiguration(EXTENSION_NAME);
                if (!hasChanged) {
                    return;
                }

                this.onConfigChange();
            })
        );
    }

    /**
     * 是否已安装
     *
     * @return {*}
     * @memberof Background
     */
    public hasInstalled(): Promise<boolean> {
        return this.htmlFile.hasPatched();
    }

    /**
     * 卸载
     *
     * @return {*}  {Promise<boolean>} 是否成功卸载
     * @memberof Background
     */
    public async uninstall(): Promise<boolean> {
        await this.removeLegacyJsPatch();
        return this.htmlFile.restore();
    }

    /**
     * 释放资源
     *
     * @memberof Background
     */
    public dispose(): void {
        this.disposables.forEach(n => n.dispose());
        this.disposeFolderWatchers();
    }

    // #endregion
}
