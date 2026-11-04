import fs from 'node:fs';
import path from 'node:path';

import vscode, { type Disposable, l10n } from 'vscode';

import { _ } from '../utils';
import { DATA_DIR, ENCODING, EXT_ROOT, EXTENSION_NAME, TOUCH_FILE_PATH, VERSION } from '../utils/constants';
import { getLegacyJsPath, getWorkbenchHtmlPath } from '../utils/patchTargets';
import { vsHelp } from '../utils/vsHelp';
import { EFilePatchType, HtmlPatchFile, JsPatchFile } from './PatchFile';
import { PatchGenerator, type TPatchGeneratorConfig } from './PatchGenerator';
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
    private profiles = new WorkspaceProfiles(path.join(DATA_DIR, 'workspace-profiles.json'));

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
            const content = JSON.stringify(this.createState());
            // skip identical writes, every window writes on config changes
            if (fs.existsSync(this.stateFilePath) && fs.readFileSync(this.stateFilePath, ENCODING) === content) {
                return;
            }
            fs.writeFileSync(this.stateFilePath, content, ENCODING);
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

        const hasInstalled = await this.hasInstalled();
        // global switch, a workspace can only turn its own background off
        const enabled = this.globalConfig.enabled;

        // 禁用
        if (!enabled) {
            if (hasInstalled) {
                vsHelp.reload({
                    message: l10n.t('Background will be disabled.'),
                    btnReload: l10n.t('Disable and Reload'),
                    beforeReload: () => this.uninstall()
                });
            }
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
     * Forgets the background of every project, keeping only the global one.
     */
    public async clearWorkspaceProfiles() {
        this.profiles.clear();
        this.syncWorkspaceProfile();
        return this.applyPatch();
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
    }

    // #endregion
}
