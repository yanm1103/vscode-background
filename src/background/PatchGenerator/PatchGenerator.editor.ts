import { AbsPatchGenerator, css, type TSectionCarousel } from './PatchGenerator.base';
import { ThemePatchGenerator } from './PatchGenerator.theme';

export class EditorPatchGeneratorConfig {
    useFront = true;
    style: Record<string, string> = {};
    styles: Array<Record<string, string>> = [];
    images: string[] = [];
    interval = 0;
    random = false;
}

export class EditorPatchGenerator extends AbsPatchGenerator<EditorPatchGeneratorConfig> {
    /**
     * 用于每张图片独立样式的占位符前缀， template.replace(placeholder, dynamicStyle) => style
     *
     * @private
     * @memberof EditorPatchGenerator
     */
    private readonly cssPlaceholder = '--background-editor-placeholder';

    private get curConfig() {
        // 默认值实际在 package.json 中定义，会 deep merge
        return {
            ...new EditorPatchGeneratorConfig(),
            ...this.config
        };
    }

    private get imageStyles() {
        const { images, style, styles } = this.curConfig;

        return images.map((img, index) => {
            return this.serializeStyle({
                ...style,
                ...styles[index],
                'background-image': `url(${img})`
            });
        });
    }

    private get styleTemplate() {
        const { images, useFront } = this.curConfig;

        // ------ 在前景图时使用 ::after ------
        const frontContent = useFront ? 'after' : 'before';

        // ------ 生成样式 ------
        return this.compileCSS(css`
            /* minimap */
            .minimap {
                opacity: 0.8;
            }

            /* 主窗口的 editor part 是 #workbench.parts.editor，
               而浮动编辑器窗口（auxiliary window）的 editor part 只有 class 没有 id，
               所以这里用 class 选择器同时覆盖两者 */
            .monaco-workbench .part.editor .split-view-view {
                /* 处理一块背景色遮挡 */
                .editor-container .overflow-guard > .monaco-scrollable-element > .monaco-editor-background {
                    background: none;
                }
                /* 背景图片样式 */
                ${images.map((_img, index) => {
                    const nthChild = `${images.length}n + ${index + 1}`;

                    return css`
                        /* code editor */
                        &:nth-child(${nthChild}) .editor-instance > .monaco-editor > .overflow-guard > .monaco-scrollable-element::${frontContent} {
                            content: '';
                            width: 100%;
                            height: 100%;
                            position: absolute;
                            z-index: ${useFront ? 99 : 'initial'};
                            pointer-events: ${useFront ? 'none' : 'initial'};
                            transition: 0.3s;
                            background-repeat: no-repeat;
                            mix-blend-mode: var(${ThemePatchGenerator.cssMixBlendMode});
                            /* placeholder，用于动态替换css */
                            ${this.cssPlaceholder + (index % images.length)}: #000;
                            ${this.cssPlaceholder + '-end'}: #000;
                        }
                    `;
                })}
            }
        `);
    }

    protected getCarousel(): TSectionCarousel | null {
        const { images, interval, random } = this.curConfig;
        if (!images.length) {
            return null;
        }
        return {
            kind: 'template',
            template: this.styleTemplate,
            placeholder: this.cssPlaceholder,
            imageStyles: this.imageStyles,
            interval,
            random
        };
    }
}
