# Disclosure

What Omacube puts on your computer, written from the source at this commit.

## What it is and what runs it

Omacube is an Omarchy shell plugin of kind `service`. Its entry point, `Service.qml` (with `RestSlot.qml`, the rest cache it uses), runs inside `omarchy-shell` (Quickshell) **with your user account's full access, unsandboxed**, like every Omarchy plugin. It loads only after you enable it.

## What it needs

- Omarchy's shell (Quickshell with Qt 6) and a GPU that Qt Quick can run fragment shaders on.
- Nothing else. There are no extra packages, scripts, daemons or services.

## What it writes

Nothing. The plugin creates no files, folders, caches or settings.

## What it reads

| What | How | Why |
|---|---|---|
| `shaders/omacube.frag.qsb` (in the plugin folder) | Qt's `ShaderEffect` loads it | The compiled shader that draws the background. It rebuilds byte-for-byte from `shaders/omacube.frag`; see [shaders/PROVENANCE.md](shaders/PROVENANCE.md) for the tool, command and hashes |
| `shaders/eggcube.frag.qsb` (in the plugin folder) | Qt's `ShaderEffect` loads it, only while you play the easter egg | The floating cube; built from `shaders/eggcube.frag`, see PROVENANCE.md |
| `mosaic.png` (in the plugin folder) | A hidden Qt `Image`, handed to the shader as a texture | The sticker colours of the 20 cube states that spell OMARCHY |
| The focused workspace ID, each monitor's active workspace, and whether that workspace has a fullscreen window | Quickshell's built-in `Quickshell.Hyprland` module, from Hyprland's event socket | The sideways slide on a workspace switch, and pausing while a fullscreen window covers the screen |
| Each workspace's windows, and whether each is floating | Quickshell's `Hyprland.refreshToplevels()`, which asks Hyprland for its client list over its request socket; re-asked 60 ms after a window opens, closes, moves or changes floating mode (Hyprland's raw events, of which only the event name is used) | `pauseUnderWindows`: pausing while tiled windows fill the workspace. Hyprland's client list and events also carry each window's class and title; Quickshell receives them, and the plugin reads only the `floating` flag and the event name |
| The plugin's own entry in `~/.config/omarchy/shell.json` (the object with `"id": "tiedeyez.omacube"`) | `FileView`, watched for changes; parsed as JSON, and only the keys `renderWidth`, `pixelSize`, `fps`, `pauseUnderWindows`, `cubeSizes` and `easterEgg` are used, each range-checked | Optional per-machine settings |
| The list of screens | `Quickshell.screens` | One background surface per screen |
| `~/.local/state/omarchy/current/theme/colors.toml` | Quickshell's `FileView`, the same way Omarchy's own shell reads it | The sticker and plastic colours. Only `key = "#rrggbb"` lines are used, and only within the first 64 KiB and 512 lines; everything else is ignored |
| `~/.local/state/omarchy/current/theme.name` | `FileView`, watched for changes; its content is never used | `omarchy theme set` rewrites it after switching themes, which tells the plugin to read `colors.toml` again |
| `HOME` | `Quickshell.env` | To build the two paths above |

It does not read your other files, your wallpaper, other environment variables, the clipboard or window contents, and it does not use window titles or classes (see the client-list row above).

## What it shows

One layer-shell surface per screen, namespace `tiedeyez-omacube`, on the `bottom` layer: above the stock wallpaper and below windows. It never takes keyboard focus. Its input region is a square at the centre of the screen, a fifth of the screen's height across, so clicks anywhere else fall through to the desktop; a double-click in the square starts the easter egg. With `easterEgg: false` in the settings, or while a window covers the desktop, the region is empty and it receives no clicks at all.

While you play the easter egg, one more surface: namespace `tiedeyez-omacube-egg`, on the `overlay` layer, covering the screen it was started on, with **exclusive keyboard focus**: every key goes to the cube until you press Esc, which closes it. It reads only the keys it uses (the letters R L U D F B M E S X Y Z H, digits, arrows, Space, Backspace, Ctrl+Z and Esc) and the mouse over that screen; nothing is stored, and nothing about it leaves the plugin.

To start the egg from the state the cube is in, the plugin renders one extra 102 x 18 pixel image of it (the same shader, a pick pass) and reads that image back through a hidden Qt `Canvas`. It never reads the screen, other windows or other surfaces.

## Subprocesses

None. `Service.qml`, `RestSlot.qml`, `Egg.qml` and `egg.js` use no `Process`, no `execDetached` and no shell.

## Network

None. There are no listening sockets, no outbound connections, no telemetry, no analytics and no auto-update. `omarchy plugin update` is the only update path, and you run it yourself.

## Files that are not part of the running plugin

These are in the repository but run only if you run them yourself:

- `tools/build-shader.sh` runs `/usr/lib/qt6/bin/qsb` to rebuild `shaders/omacube.frag.qsb` from `shaders/omacube.frag`. It writes only that file, or the output path you pass it.
- `dev/preview.sh` runs `tools/build-shader.sh` (unless you pass a compiled shader), then `/usr/bin/qs -p dev/preview.qml` for up to 300 seconds. That shows a 1x1 click-through surface on the `bottom` layer and saves numbered PNG frames to `./frames/`, or to the folder you pass as the first argument. `dev/preview.qml` reads only its own `OMACUBE_*` environment variables.
- `dev/selfcheck.sh` builds debug versions of the shader into `./frames/selfcheck/`, renders them with `dev/preview.sh`, and counts failing pixels with `/usr/bin/python3 -I tools/png-stats.py`. It writes only inside `./frames/`.
- `tools/build-mosaic.py` is a Python standard-library script. It computes the 20 mosaic cube states and writes only `mosaic.png`.
- `tools/check-math.py` and `tools/png-stats.py` are Python standard-library scripts. They read only the PNG files you name (`check-math.py` also reads `mosaic.png` and imports `tools/build-mosaic.py`), write nothing, and start no processes.
- `tools/check-palette.mjs` is a Node script. It reads `Palette.js`, the Omacube theme's `colors.toml`, and the `colors.toml` of each installed theme (in `/usr/share/omarchy/themes/` and `~/.config/omarchy/themes/`, or the folders you name). It writes nothing and starts no processes.
- `dev/preview.qml` reads the `colors.toml` you point `OMACUBE_THEME` at, if any, and the copy of `mosaic.png` that `dev/preview.sh` stages next to it.
- `dev/sticker-window.sh` runs `/usr/bin/foot` with a sticker colour and a big number, then `/usr/bin/sleep infinity` inside it. It's a demo window for trying out the tiling; close it like any other window.
- `tools/check-cubeface.lua` is a plain Lua script that loads `cubeface.lua` and checks its maths. It reads nothing else and writes nothing.
- `theme/omacube/` is an Omarchy theme, used only if you copy it into `~/.config/omarchy/themes/` and select it. It holds `colors.toml`, `icons.theme`, the stock Omarchy wallpaper and unlock art recoloured, `preview.png`, and two Lua files that Hyprland runs while the theme is active:
  - `hyprland.lua` sets border colours, rounding and animation curves. It makes the cube-face layout the tiling layout and binds six keys to cube turns (SUPER+ALT+R, SUPER+ALT+SHIFT+R, SUPER+CTRL+ALT+arrows).
  - `cubeface.lua` is the layout: it decides where each tiled window goes. It reads only the window list Hyprland hands it and the address of the focused window. It starts no processes, reads and writes no files, and opens no network connections.
  - `fastfetch-logo.py` is a Python script that prints a scrambled cube as text art for fastfetch. It runs only if you set it as fastfetch's logo command. It reads the `colors.toml` beside it in one open that refuses symlinks and non-regular files (first 64 KiB, 512 lines), uses Python's `random` for the scramble, writes only to stdout, starts no processes and opens no network connections.
  All of this is undone when you switch to another theme. One thing outlives the switch: the layout name `lua:omacube` stays registered with Hyprland until it restarts. It's unused, but it's there.

## What it costs

An animated background makes the compositor repaint every frame, including blur behind translucent windows. On an RTX 4070 SUPER at 3440x1440, whole-GPU power with the background showing is about 23 W at the default (the screen's own resolution), about 29 W at the optional 6K and about 14 W as pixel art, against about 6 W with nothing showing (0.3.3 drew about 54 W, 147 W and 17 W). On an Intel HD 520 at 1600x900 the default keeps the GPU about 78% busy at about 720 MHz, against about 50% for any full-screen animation. Redrawing stops while a fullscreen window covers the screen, or tiled windows fill it. See the README's Settings and Performance sections for how to lower the resolution and frame rate.

## Maintainer and licence

Tiedeyez, MIT licence (see [LICENSE](LICENSE)).

## Check it yourself

```bash
# the running plugin starts no processes, opens no sockets and writes nothing:
grep -nE "Process|execDetached|XMLHttpRequest|Socket|saveToFile|setText" Service.qml RestSlot.qml Egg.qml egg.js Palette.js
# expected: no output

# its only file reads are the two theme files listed above, plus its own mosaic.png:
grep -nE "FileView|path:|source:|Quickshell.env" Service.qml RestSlot.qml Egg.qml egg.js

# rebuild the shader from source and compare:
tools/build-shader.sh && git status --short shaders/
```
