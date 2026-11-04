import { _ } from '../../utils';
import { AuxiliarybarPatchGenerator, type AuxiliarybarPatchGeneratorConfig } from './PatchGenerator.auxiliarybar';
import type { TSectionData } from './PatchGenerator.base';
import { ChecksumsPatchGenerator } from './PatchGenerator.checksums';
import { EditorPatchGenerator, type EditorPatchGeneratorConfig } from './PatchGenerator.editor';
import { FullscreenPatchGenerator, type FullscreenPatchGeneratorConfig } from './PatchGenerator.fullscreen';
import { PanelPatchGenerator, type PanelPatchGeneratorConfig } from './PatchGenerator.panel';
import {
    createRuntime,
    type TBackgroundState,
    type TProfileData,
    type TRuntimeOptions
} from './PatchGenerator.runtime';
import { SidebarPatchGenerator, type SidebarPatchGeneratorConfig } from './PatchGenerator.sidebar';
import { ThemePatchGenerator } from './PatchGenerator.theme';

export type { TBackgroundState } from './PatchGenerator.runtime';

export type TPatchGeneratorConfig = {
    enabled: boolean;
    editor: EditorPatchGeneratorConfig;
    sidebar: SidebarPatchGeneratorConfig;
    auxiliarybar: AuxiliarybarPatchGeneratorConfig;
    panel: PanelPatchGeneratorConfig;
    fullscreen: FullscreenPatchGeneratorConfig;
};

export class PatchGenerator {
    /**
     * Background sections (editor, sidebar...) of one config, as data.
     */
    private static createProfile(options: TPatchGeneratorConfig): TProfileData {
        if (options.enabled === false) {
            return { sections: [] };
        }

        const sections = [
            new EditorPatchGenerator(options.editor).createSection(), // editor,
            new SidebarPatchGenerator(options.sidebar).createSection(), // sidebar
            new AuxiliarybarPatchGenerator(options.auxiliarybar).createSection(), // auxiliarybar
            new PanelPatchGenerator(options.panel).createSection(), // panel
            new FullscreenPatchGenerator(options.fullscreen).createSection() // fullscreen
        ].filter((n): n is TSectionData => !!n);

        return { sections };
    }

    /**
     * Backgrounds of every window: the global one plus one per workspace profile.
     * With `enabled: false` (global) every window is left without background.
     */
    public static createState(
        options: TPatchGeneratorConfig,
        profiles: Record<string, TPatchGeneratorConfig> = {}
    ): TBackgroundState {
        const state: TBackgroundState = { fallback: { sections: [] }, profiles: {} };
        if (options.enabled === false) {
            return state;
        }

        state.fallback = this.createProfile(options);
        for (const [key, config] of Object.entries(profiles)) {
            state.profiles[key] = this.createProfile(config);
        }
        return state;
    }

    /**
     * Script injected in workbench.html.
     */
    public static async create(options: TRuntimeOptions) {
        const script = [
            // global
            new ChecksumsPatchGenerator().create(), // fix checksums
            new ThemePatchGenerator().create(), // hack theme
            // sections, drawn from the state
            createRuntime(options)
        ]
            .filter(n => !!n.length)
            .map(n => _.withIIFE(n))
            .join(';');

        const { minify } = await import('terser');
        return (await minify(script)).code ?? script;
    }
}
