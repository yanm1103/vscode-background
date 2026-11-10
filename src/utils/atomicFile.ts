import fs from 'node:fs';

import { ENCODING } from './constants';

/** Blocks for a few milliseconds, the callers are synchronous */
function sleep(ms: number) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Writes through a temp file and a rename, so other windows never read a half-written file.
 *
 * On Windows the rename fails while any process has the target open (another window reading it),
 * so it is retried and, as a last resort, the file is written in place like before.
 */
export function writeFileAtomic(filePath: string, content: string) {
    // writes are synchronous, one temp file per process is enough
    const tmpPath = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(tmpPath, content, ENCODING);

    for (let attempt = 0; attempt < 4; attempt++) {
        try {
            fs.renameSync(tmpPath, filePath);
            return;
        } catch (error) {
            const code = (error as NodeJS.ErrnoException).code ?? '';
            if (!['EPERM', 'EBUSY', 'EACCES'].includes(code)) {
                break;
            }
            sleep(15);
        }
    }

    fs.rmSync(tmpPath, { force: true });
    fs.writeFileSync(filePath, content, ENCODING);
}
