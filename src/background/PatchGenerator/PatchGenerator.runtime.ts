import type { TSectionData } from './PatchGenerator.base';

export type TProfileData = { sections: TSectionData[] };

/**
 * Everything the runtime needs to draw the backgrounds.
 * `profiles` is keyed by workspace (see toWorkspaceKey), `fallback` is used by every other window.
 */
export type TBackgroundState = {
    fallback: TProfileData;
    profiles: Record<string, TProfileData>;
};

export type TRuntimeOptions = {
    /** vscode-file:// url of the state file, polled for live updates (desktop) */
    stateUrl?: string;
    /** state embedded in the patch, used when the state file cannot be read (code-server / web) */
    initialState?: TBackgroundState;
};

/** How often windows look for changes in the state file */
export const POLL_INTERVAL_MS = 2000;

/**
 * Script injected in workbench.html. It does not change with the user settings:
 * it reads them from the state file, so new settings show up without reloading the window.
 */
export function createRuntime({ stateUrl, initialState }: TRuntimeOptions) {
    // keep toKey in sync with toWorkspaceKey (WorkspaceProfiles.ts)
    return `
const stateUrl = ${JSON.stringify(stateUrl ?? '')};
const initialState = ${JSON.stringify(initialState ?? null)};
const pollInterval = ${POLL_INTERVAL_MS};

// one long-lived entry per section, so a settings change updates it in place
// instead of restarting every carousel
const entries = new Map();
let lastState = null;
let workspaceKey = null;

// writing '' over css does not reach floating windows (VS Code only syncs added text),
// sections without css are removed instead (see render)
function setText(node, text) {
    if (node.textContent !== text) {
        node.textContent = text;
    }
}

function createEntry() {
    const entry = {
        // static css first, so the css of the current image overrides it
        style: document.head.appendChild(document.createElement('style')),
        frame: document.head.appendChild(document.createElement('style')),
        preload: document.createElement('div'),
        order: [],
        index: 0,
        timer: 0
    };
    entry.preload.style.cssText = 'width:0;height:0;opacity:0;overflow:hidden';
    entry.preload.appendChild(document.createElement('div'));
    document.body.appendChild(entry.preload);
    return entry;
}

function removeEntry(entry) {
    clearInterval(entry.timer);
    entry.style.remove();
    entry.frame.remove();
    entry.preload.remove();
}

function shuffle(list) {
    for (let i = list.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
}

// Draws the current images of a section, moving to the next ones when 'advance' is set.
// 'order' holds the image shown ('rules') or the image of each split view ('template').
function draw(entry, advance) {
    const data = entry.data;
    const isRules = data.kind === 'rules';
    const list = (isRules ? data.rules : data.imageStyles) || [];
    const count = list.length;
    if (!count) {
        return;
    }

    // other images or mode: start over, like a window that just loaded
    const reset = entry.count !== count || entry.random !== data.random;
    if (reset || advance) {
        entry.index = reset ? 0 : (entry.index + 1) % count;
        entry.count = count;
        entry.random = data.random;
        if (data.random) {
            entry.order = isRules ? [Math.floor(Math.random() * count)] : shuffle(list.map((_s, i) => i));
        } else {
            entry.order = list.map((_s, i) => (entry.index + i) % count);
        }
    }

    if (isRules) {
        setText(entry.frame, list[entry.order[0]]);
        return;
    }
    let css = data.template;
    for (let i = 0; i < count; i++) {
        // the ':' keeps placeholder1 from matching placeholder10, the function keeps '$' in urls literal
        css = css.replace(new RegExp(data.placeholder + i + ':[^;]+;', 'g'), () => list[entry.order[i]]);
    }
    setText(entry.frame, css);
}

function update(entry, data) {
    entry.data = data;
    setText(entry.style, data.style || '');
    entry.preload.firstChild.style.backgroundImage = (data.preload || []).map(url => 'url(' + url + ')').join(',');

    // the timer reads entry.data, it only restarts when the interval changes
    const interval = data.interval > 0 ? data.interval : 0;
    if (interval !== entry.interval) {
        entry.interval = interval;
        clearInterval(entry.timer);
        entry.timer = interval ? setInterval(() => draw(entry, true), interval * 1000) : 0;
        if (!interval) {
            // stopped: back to the first image
            entry.count = -1;
        }
    }
    draw(entry, false);
}

function render(profile) {
    const seen = new Set();
    ((profile && profile.sections) || []).forEach((section, i) => {
        // states written by older versions have no id
        const id = section.id || 's' + i;
        seen.add(id);
        let entry = entries.get(id);
        if (!entry) {
            entry = createEntry();
            entries.set(id, entry);
        }
        // untouched sections keep their image and timer
        const text = JSON.stringify(section);
        if (text !== entry.text) {
            entry.text = text;
            update(entry, section);
        }
    });
    entries.forEach((entry, id) => {
        if (!seen.has(id)) {
            removeEntry(entry);
            entries.delete(id);
        }
    });
}

function toKey(uri) {
    return (uri.scheme + '://' + (uri.authority || '') + uri.path).toLowerCase();
}

async function getWorkspaceKey() {
    if (workspaceKey !== null) {
        return workspaceKey;
    }
    try {
        const config = await globalThis.vscode.context.resolveConfiguration();
        const workspace = config && config.workspace;
        const uri = workspace && (workspace.configPath || workspace.uri);
        workspaceKey = uri ? toKey(uri) : '';
    } catch {
        workspaceKey = '';
    }
    return workspaceKey;
}

async function apply(state) {
    const key = await getWorkspaceKey();
    const profiles = state.profiles || {};
    render(Object.prototype.hasOwnProperty.call(profiles, key) ? profiles[key] : state.fallback);
}

async function refresh() {
    try {
        const res = await fetch(stateUrl + '?t=' + Date.now(), { cache: 'no-store' });
        if (!res.ok) {
            return;
        }
        // most polls find the same file, skip parsing it
        const text = await res.text();
        if (text === lastState) {
            return;
        }
        await apply(JSON.parse(text));
        lastState = text;
    } catch {}
}

if (initialState) {
    apply(initialState);
}

if (stateUrl) {
    refresh();
    setInterval(() => {
        if (document.visibilityState === 'visible') {
            refresh();
        }
    }, pollInterval);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            refresh();
        }
    });
}
`;
}
