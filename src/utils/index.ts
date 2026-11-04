import { pathToFileURL } from 'node:url';

import sudo from '@vscode/sudo-prompt';

import { vsc } from './vsc';

export namespace _ {
    /**
     * if desktop
     *
     * desktop: `desktop`
     * code-server: `server-distro`
     * See: https://code.visualstudio.com/api/references/vscode-api#env
     */
    export const isDesktop = vsc?.env.appHost === 'desktop';

    /**
     * 提权运行
     *
     * @export
     * @param {string} cmd
     * @param {{ name?: string }} [options={}]
     * @return {*}  {Promise<any>}
     */
    export function sudoExec(cmd: string, options: { name?: string } = {}): Promise<any> {
        return new Promise((resolve, reject) => {
            sudo.exec(cmd, options, (error?: Error, stdout?: string | Buffer, stderr?: string | Buffer) => {
                if (error) {
                    reject(error);
                }
                resolve([stdout, stderr]);
            });
        });
    }

    /**
     * wrap with IIFE
     *
     * @export
     * @param {string} source
     * @return {*}
     */
    export function withIIFE(source: string) {
        return `;(function() { ${source} })();`;
    }

    /**
     * Local path to the url windows can load it from.
     * `C:\\foo\\bar.svg` => `vscode-file://vscode-app/c%3A/foo/bar.svg`
     */
    export function toVscodeFileUrl(filePath: string) {
        return pathToFileURL(filePath).href.replace('file://', 'vscode-file://vscode-app');
    }
}
