# Disclosure

What Omacube puts on your computer, written from the source at this commit.

## What it is and what runs it

Omacube is an Omarchy shell plugin of kind `service`. Its entry point, `Service.qml`, runs inside `omarchy-shell` (Quickshell) **with your user account's full access, unsandboxed**, like every Omarchy plugin. It loads only after you enable it.

## What it needs

- Omarchy's shell (Quickshell with Qt 6) and a GPU that Qt Quick can run fragment shaders on.
- Nothing else. There are no extra packages, scripts, daemons or services.

## What it writes

Nothing. The plugin creates no files, folders, caches or settings.

## What it reads

| What | How | Why |
|---|---|---|
| `shaders/omacube.frag.qsb` (in the plugin folder) | Qt's `ShaderEffect` loads it | The compiled shader that draws the background |
| The focused workspace ID, each monitor's active workspace, and whether that workspace has a fullscreen window | Quickshell's built-in `Quickshell.Hyprland` module, from Hyprland's event socket | The twist on a workspace switch, and pausing while a fullscreen window covers the screen |
| The list of screens | `Quickshell.screens` | One background surface per screen |

It does not read your files, your wallpaper, your theme, environment variables, the clipboard, window titles or window contents.

## What it shows

One layer-shell surface per screen, namespace `tiedeyez-omacube`, on the `bottom` layer: above the stock wallpaper and below windows. It has an empty input region, so it never receives clicks or keyboard focus.

## Subprocesses

None. `Service.qml` uses no `Process`, no `execDetached` and no shell.

## Network

None. There are no listening sockets, no outbound connections, no telemetry, no analytics and no auto-update. `omarchy plugin update` is the only update path, and you run it yourself.

## Files that are not part of the running plugin

These are in the repository but run only if you run them yourself:

- `tools/build-shader.sh` runs `/usr/lib/qt6/bin/qsb` to rebuild `shaders/omacube.frag.qsb` from `shaders/omacube.frag`. It writes only that file.
- `dev/preview.sh` runs `tools/build-shader.sh`, then `/usr/bin/qs -p dev/preview.qml` for up to 300 seconds. That shows a 1x1 click-through surface on the `bottom` layer and saves numbered PNG frames to `./frames/`, or to the folder you pass as the first argument.
- `theme/omacube/` is a plain Omarchy theme: `colors.toml`, `hyprland.lua` (border colours, rounding, animation curves), `icons.theme`, the stock Omarchy wallpaper and unlock art recoloured, and `preview.png`. It's used only if you copy it into `~/.config/omarchy/themes/` and select it. Its `hyprland.lua` changes Hyprland settings while the theme is active, and those changes are gone when you switch themes.

## What it costs

An animated background makes the compositor repaint every frame, including blur behind translucent windows. In testing on an RTX 4070 SUPER at 3440x1440, GPU power went from about 7 W to about 21 W with the plugin enabled. Redrawing stops while a fullscreen window covers the screen. See the README for how to lower the frame rate and resolution.

## Maintainer and licence

Tiedeyez, MIT licence (see [LICENSE](LICENSE)).

## Check it yourself

```bash
# the running plugin has no process, file, network or env access:
grep -nE "Process|FileView|execDetached|XMLHttpRequest|Socket|Quickshell.env|saveToFile" Service.qml
# expected: no output

# rebuild the shader from source and compare:
tools/build-shader.sh && git status --short shaders/
```
