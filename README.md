<!-- 中英文切换 -->
<div align="right">

**English** | [中文](./README.zh-CN.md) | [日本語](./README.ja-JP.md)

</div>
<!-- 中英文切换 end -->

<!-- 封面区域 -->
<div align="center">

![logo](./images/logo.png)

<h1><b>vscode-background</b></h1>

### Bring background images to your [Visual Studio Code](https://code.visualstudio.com)

`fullscreen`, `editor`, `sidebar`, `auxiliarybar`, `panel`, `carousel`, `custom images/styles`...

[GitHub](https://github.com/shalldie/vscode-background) | [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=shalldie.background)

[![Version](https://img.shields.io/badge/version-3.3.0-blue?style=flat-square)](./CHANGELOG.md)
[![Stars](https://img.shields.io/github/stars/shalldie/vscode-background?logo=github&style=flat-square)](https://github.com/shalldie/vscode-background)
[![Build Status](https://img.shields.io/github/actions/workflow/status/shalldie/vscode-background/ci.yml?branch=master&label=build&style=flat-square)](https://github.com/shalldie/vscode-background/actions)
[![License](https://img.shields.io/github/license/shalldie/vscode-background?style=flat-square)](https://github.com/shalldie/vscode-background)

Multiple sections, `editor`, `sidebar`, `auxiliarybar`, `panel`

<img width="760" src="./images/section.webp">

`fullscreen`

<img width="760" src="./images/fullscreen.webp">

</div>

</div>

<!-- 封面区域 end -->

> [!NOTE]
> This is a fork of [shalldie/vscode-background](https://github.com/shalldie/vscode-background).
> It adds **per-project backgrounds** and **live updates**: each project can have its own background, and changing a setting no longer reloads the window.
> See [What this fork changes](#what-this-fork-changes) for everything that differs from the original.

## Installation

The fork is not on the Marketplace. Build it and install the `.vsix`:

```bash
npm install
npm run package          # creates background-<version>.vsix
code --install-extension background-<version>.vsix
```

If the original extension is installed, uninstall it first (`code --uninstall-extension shalldie.background`). Both use the same `background.*` settings and would overwrite each other's patch.

The fork's ID is `twistzero.background`, so the Marketplace never replaces it with the original during an auto-update.

Then run `Developer: Reload Window` and click **Apply and Reload** when asked.

## What this fork changes

Based on [shalldie/vscode-background](https://github.com/shalldie/vscode-background) v3.1.0. The settings (`background.*`) are the same, so an existing configuration keeps working.

|                                                       | Original                                 | This fork                                                              |
| :---------------------------------------------------- | :--------------------------------------- | :--------------------------------------------------------------------- |
| Scope of a background                                 | One background for every window          | One per project, set in `.vscode/settings.json` or `.code-workspace`   |
| Applying a setting                                    | `Apply and Reload` after every change    | Applied live in about 2 seconds, no reload                             |
| What `workbench.html` holds                           | The images and styles themselves         | A fixed script that reads the backgrounds from `~/.vscode-background/` |
| `fullscreen`/`sidebar`/`panel`/`auxiliarybar` `style` | Ignored                                  | Applied over `size`, `position` and `opacity`                          |
| Image folders                                         | Listed once, when applying               | Watched, new or removed images show up by themselves                   |
| Changing a setting while a carousel runs              | Everything restarts from the first image | The carousel keeps its image and timer                                 |
| Extension ID                                          | `shalldie.background`                    | `twistzero.background` (the Marketplace never replaces the fork)       |

### 1. Per-project backgrounds

Any `background.*` value found in a project's `.vscode/settings.json` or `.code-workspace` now applies **only to that project**. Windows of different projects can be open at the same time, each with its own background. Project values merge over your user values like regular VS Code settings, and `"background.enabled": false` inside a project turns off only that project.

How: each window saves the overrides of its own project, the extension merges them with the user settings and writes the result for every project into one state file. Each window asks VS Code which folder or workspace it has open and draws the matching entry (or the user background when the project has none). Details in [Per-project backgrounds](#per-project-backgrounds) and [How it works](#how-it-works).

### 2. Live updates

The patch in `workbench.html` no longer contains your images, so it does not change when your settings do. Windows read the state file every 2 seconds (only while visible) and redraw. **Apply and Reload** is now only needed after installing or updating the extension and after a VS Code update. code-server cannot read the file and keeps the original reload flow.

### 3. `style` works in `fullscreen`, `sidebar`, `panel` and `auxiliarybar`

In the original, only `editor` read `style` (for example `"background-size": "contain"`); in the other sections it was silently dropped, so `background-size`, `background-position` and `opacity` written that way had no effect. Now `style` is applied there too, over `size`, `position` and `opacity`. Note that `style.opacity` is not limited to the `0 ~ 0.6` range of the `opacity` option.

### 4. Image folders are watched

When an image setting points to a folder, the extension watches it with VS Code's file watcher (recursive on every platform, waits for folders that do not exist yet). Adding, removing or renaming an image updates the background about 1 second after the last change. Each window watches only the folders it draws.

Limits: `files.watcherExclude` applies; images inside symlinked subfolders only refresh on the next settings change; on Windows the parent of a watched folder cannot be renamed while VS Code is open.

### 5. Safer storage

- Files in `~/.vscode-background/` are written to a temporary file and renamed, so a window never reads a half-written state. On Windows a rename can fail while another window is reading, so it is retried and, as a last resort, written in place.
- Projects are stored **one file each** (`profiles/<hash>.json`) instead of one shared JSON, so two windows saving at the same time cannot lose each other's project. The old `workspace-profiles.json` is migrated automatically on first use.
- After writing the state, the extension checks the profiles again, so a project saved by another window in the meantime is not left out.

### 6. Incremental redraw

Every section (`editor`, `sidebar`, `auxiliarybar`, `panel`, `fullscreen`) keeps its style nodes and carousel timer. Changing the opacity, a custom style or other options updates the CSS in place: the current image stays on screen and the carousel keeps its timer. Sections that disappear are removed. Changing the image list, turning `random` on or off, or stopping the carousel (`interval: 0`) goes back to the first image, as a freshly loaded window would.

### 7. Fixes

- With more than 10 images in `editor`, the placeholder of image 1 also matched images 10 to 19, so those images were drawn in the wrong split views.
- `$` characters in image URLs are no longer interpreted when the CSS is assembled.

### 8. New commands

| Command                                               | What it does                                                                                                                                                                  |
| :---------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Background: Add background settings to this project` | Asks for a section and images, writes a `background.*` block with every option to the project's `.vscode/settings.json` (folder and file are created if missing) and opens it |

## Custom

User defined requirements can be met by changing the configuration(`settings.json`).

[what's `settings.json`](https://code.visualstudio.com/docs/getstarted/settings#_settingsjson) | [where?](https://github.com/shalldie/vscode-background/issues/274)

## Config

<img width="760" src="./images/containers.webp">

### Per-project backgrounds

Put any `background.*` setting in a project's `.vscode/settings.json` (or in a `.code-workspace` file) to give that project its own background. Projects without one use your user settings.

```jsonc
// <project>/.vscode/settings.json
{
  "background.fullscreen": {
    "images": ["C:/Users/me/Pictures/this-project.png"]
  }
}
```

- Windows of different projects can be open at the same time, each with its own background.
- Project values merge over the user values, like VS Code settings do. In the example above, the project keeps the user `opacity`, `size` and other options.
- `"background.enabled": false` in a project turns off only that project. The user setting stays the main switch.
- `Background: Add background settings to this project` writes a starting `background.*` block to the project's `.vscode/settings.json` (created if missing) and opens it.
- Projects whose folder was deleted are dropped automatically.

### Live updates

Settings apply without reloading. Open windows redraw within about 2 seconds of saving `settings.json`. Minimized windows catch up when they are shown again.

**Apply and Reload** is still needed:

- after installing or updating the extension;
- after a VS Code update, because the update restores the original `workbench.html`.

On code-server the window cannot read the state file, so there the extension keeps the original flow: every change needs **Apply and Reload**.

### How it works

The original extension writes the images straight into VS Code's `workbench.html`, a single file shared by every window. That is why its background is global.

The fork writes only a fixed script into `workbench.html`. The backgrounds live in `~/.vscode-background/`:

| File              | Content                                                                       |
| :---------------- | :---------------------------------------------------------------------------- |
| `profiles/*.json` | The `background.*` settings of every project opened so far, one file each.    |
| `state.svg`       | The styles of every background, for all projects. JSON despite the extension. |

Each window asks VS Code which folder or `.code-workspace` it has open and draws the matching background from `state.svg`. When a setting changes, the extension rewrites `state.svg` and every visible window picks it up on its next check, every 2 seconds.

`state.svg` uses the `.svg` extension because VS Code windows may only read files outside VS Code's own folders when they are images.

Folders of images are expanded to their files when the state is written, which is why they are watched (see [What this fork changes](#4-image-folders-are-watched)).

Use `Background: [Dev] Preview Patch` to see the injected script and the current state.

### Global Config

| Name                 |   Type    | Default | Description                             |
| :------------------- | :-------: | :-----: | :-------------------------------------- |
| `background.enabled` | `Boolean` | `true`  | Whether to enable background extension. |

### Editor Section Config

Edit `background.editor` to config editor section.

| Name       |    Type    | Default | Description                                                          |
| :--------- | :--------: | :-----: | :------------------------------------------------------------------- |
| `useFront` | `boolean`  | `true`  | Place the image above or below the code.                             |
| `style`    |  `object`  |  `{}`   | Custom style for images. [MDN Reference][mdn-css]                    |
| `styles`   | `object[]` |  `[]`   | Custom style for each image individually.                            |
| `images`   | `string[]` |  `[]`   | Custom images, supports online and local images, as well as folders. |
| `interval` |  `number`  |   `0`   | Seconds of interval for carousel, default `0` to disabled.           |
| `random`   | `boolean`  | `false` | Whether to randomly display images.                                  |

[mdn-css]: https://developer.mozilla.org/docs/Web/CSS

example:

```json
{
  "background.editor": {
    "useFront": true,
    "style": {
      "background-position": "100% 100%",
      "background-size": "auto",
      "opacity": 0.6
    },
    "styles": [],
    // `images` supports online and local images, as well as folders.
    "images": [
      // online images, only `https` is allowed.
      "https://hostname/online.jpg",
      // local images
      "file:///local/path/img.jpeg",
      "/home/xie/downloads/img.gif",
      "C:/Users/xie/img.bmp",
      "D:\\downloads\\images\\img.webp",
      // `~` and environment variables are supported in local paths
      "~/Pictures/img.png",
      "${HOME}/Pictures/img.png",
      // local folders
      "/home/xie/images",
      // data URL
      "data:image/*;base64,<base64-data>"
    ],
    "interval": 0,
    "random": false
  }
}
```

### Fullscreen, Sidebar, Auxiliarybar, Panel Section Config

Edit `background.fullscreen`, `background.sidebar`, `background.auxiliarybar`, `background.panel` to config these sections.

| Name       |    Type    | Default  | Description                                                                                          |
| :--------- | :--------: | :------: | :--------------------------------------------------------------------------------------------------- |
| `images`   | `string[]` |   `[]`   | Custom images, supports online and local images, as well as folders.                                 |
| `opacity`  |  `number`  |  `0.1`   | Opacity of the images, alias to [opacity][mdn-opacity], `0.1 ~ 0.3` recommended.                     |
| `size`     |  `string`  | `cover`  | Alias to [background-size][mdn-background-size], `cover` to self-adaption (recommended).             |
| `position` |  `string`  | `center` | Alias to [background-position][mdn-background-position], default `center`.                           |
| `style`    |  `object`  |   `{}`   | Custom style for all images, applied over `size`, `position` and `opacity`. [MDN Reference][mdn-css] |
| `styles`   | `object[]` |   `[]`   | Custom style for each image individually.                                                            |
| `interval` |  `number`  |   `0`    | Seconds of interval for carousel, default `0` to disabled.                                           |
| `random`   | `boolean`  | `false`  | Whether to randomly display images.                                                                  |

[mdn-opacity]: https://developer.mozilla.org/docs/Web/CSS/opacity
[mdn-background-size]: https://developer.mozilla.org/docs/Web/CSS/background-size
[mdn-background-position]: https://developer.mozilla.org/docs/Web/CSS/background-position

example:

```json
{
  "background.fullscreen": {
    // `images` supports online and local images, as well as folders.
    "images": [
      // online images, only `https` is allowed.
      "https://hostname/online.jpg",
      // local images
      "file:///local/path/img.jpeg",
      "/home/xie/downloads/img.gif",
      "C:/Users/xie/img.bmp",
      "D:\\downloads\\images\\img.webp",
      // `~` and environment variables are supported in local paths
      "~/Pictures/img.png",
      "${HOME}/Pictures/img.png",
      // local folders
      "/home/xie/images",
      // data URL
      "data:image/*;base64,<base64-data>"
    ],
    "opacity": 0.1,
    "size": "cover",
    "position": "center",
    "styles": [],
    "interval": 0,
    "random": false
  },
  // `sidebar` and `panel` have the same config as `fullscreen`
  "background.sidebar": {},
  "background.panel": {}
}
```

## Quick Command

Click the 「Background」 button on the right-bottom of statusbar, all commands of `background` will appear:

<img width="660" src="./images/commands.webp">

## Common Issues

> **This extension works by editing the vscode's html file.**

Please refer to the [Common Issues](docs/common-issues.md) if you met some problems.

## Uninstall

Please refer to [Common Issues#how-to-uninstall](docs/common-issues.md#how-to-uninstall).

## Contributors 🙏

[<img alt="yanm1103" src="https://avatars.githubusercontent.com/u/28579030?v=4" width="80">](https://github.com/yanm1103)
[<img alt="shalldie" src="https://avatars3.githubusercontent.com/u/9987486?v=4" width="80">](https://github.com/shalldie)
[<img alt="suiyun39" src="https://avatars.githubusercontent.com/u/20502666?v=4" width="80">](https://github.com/suiyun39)
[<img alt="frg2089" src="https://avatars.githubusercontent.com/u/42184238?v=4" width="80">](https://github.com/frg2089)
[<img alt="AzureeDev" src="https://avatars.githubusercontent.com/u/23083011?v=4" width="80">](https://github.com/AzureeDev)
[<img alt="tumit" src="https://avatars.githubusercontent.com/u/1756190?v=4" width="80">](https://github.com/tumit)
[<img alt="asurinsaka" src="https://avatars.githubusercontent.com/u/8145535?v=4" width="80">](https://github.com/asurinsaka)
[<img alt="u3u" src="https://avatars.githubusercontent.com/u/20062482?v=4" width="80">](https://github.com/u3u)
[<img alt="kuresaru" src="https://avatars.githubusercontent.com/u/31172177?v=4" width="80">](https://github.com/kuresaru)
[<img alt="Unthrottled" src="https://avatars.githubusercontent.com/u/15972415?v=4" width="80">](https://github.com/Unthrottled)
[<img alt="rogeraabbccdd" src="https://avatars.githubusercontent.com/u/15815422?v=4" width="80">](https://github.com/rogeraabbccdd)
[<img alt="SatoMasahiro2005" src="https://avatars.githubusercontent.com/u/86603229?v=4" width="80">](https://github.com/SatoMasahiro2005)

## Contributing Guide

Refer to [Contributing Guide](docs/contributing.md).

## Change Log

You can checkout all our changes in our [CHANGELOG](https://github.com/shalldie/vscode-background/blob/master/CHANGELOG.md).

## Share Your Images

We share background images [here](https://github.com/shalldie/vscode-background/issues/106).

## Migration from v1

Starting from v3.0, v1 top-level configuration is no longer supported. Please refer to [migration-from-v1.md](docs/migration-from-v1.md) to migrate.

## LICENSE

MIT
