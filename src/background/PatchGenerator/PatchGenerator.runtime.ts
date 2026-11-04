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

let active = { nodes: [], timers: [] };
let lastProfile = null;
let workspaceKey = null;

function clear() {
    active.nodes.forEach(node => node.remove());
    active.timers.forEach(timer => clearInterval(timer));
    active = { nodes: [], timers: [] };
}

function addStyle(text) {
    const style = document.createElement('style');
    style.textContent = text;
    document.head.appendChild(style);
    active.nodes.push(style);
    return style;
}

function preload(images) {
    if (!images || !images.length) {
        return;
    }
    const container = document.createElement('div');
    container.style.width = 0;
    container.style.height = 0;
    container.style.opacity = 0;
    container.style.overflow = 'hidden';
    const div = document.createElement('div');
    div.style.backgroundImage = images.map(url => 'url(' + url + ')').join(',');
    container.appendChild(div);
    document.body.appendChild(container);
    active.nodes.push(container);
}

function startCarousel(section, render) {
    render();
    if (section.interval > 0) {
        active.timers.push(setInterval(render, section.interval * 1000));
    }
}

function startRules(section) {
    const style = addStyle('');
    const rules = section.rules;
    let index = -1;
    startCarousel(section, () => {
        if (section.random) {
            style.textContent = rules[Math.floor(Math.random() * rules.length)];
            return;
        }
        index = (index + 1) % rules.length;
        style.textContent = rules[index];
    });
}

function startTemplate(section) {
    const style = addStyle('');
    const imageStyles = section.imageStyles;
    let index = -1;
    startCarousel(section, () => {
        let order;
        if (section.random) {
            order = imageStyles.slice().sort(() => Math.random() - 0.5);
        } else {
            index = (index + 1) % imageStyles.length;
            order = imageStyles.map((_s, i) => imageStyles[(index + i) % imageStyles.length]);
        }
        let css = section.template;
        for (let i = 0; i < order.length; i++) {
            css = css.replace(new RegExp(section.placeholder + i + '[^;]+;', 'g'), order[i]);
        }
        style.textContent = css;
    });
}

function render(profile) {
    clear();
    ((profile && profile.sections) || []).forEach(section => {
        preload(section.preload);
        if (section.style) {
            addStyle(section.style);
        }
        if (section.kind === 'rules' && section.rules.length) {
            startRules(section);
        } else if (section.kind === 'template' && section.imageStyles.length) {
            startTemplate(section);
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
    const profile = Object.prototype.hasOwnProperty.call(profiles, key) ? profiles[key] : state.fallback;
    // only redraw when this window's background changed, so carousels and transitions are not reset
    const text = JSON.stringify(profile || null);
    if (text === lastProfile) {
        return;
    }
    lastProfile = text;
    render(profile);
}

async function refresh() {
    try {
        const res = await fetch(stateUrl + '?t=' + Date.now(), { cache: 'no-store' });
        if (res.ok) {
            await apply(JSON.parse(await res.text()));
        }
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
