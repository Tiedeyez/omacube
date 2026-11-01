# Omacube

An animated desktop background for Omarchy: an endless isometric stack of 3x3 puzzle cubes, drawn flat in sticker colours with black lines, like a vector illustration that never stops moving.

![Omacube](preview.png)

- **An endless stack.** The view looks straight down a cube's diagonal at an infinite pile of cubes stacked into towers, staircases and hexagonal stars. Every cube rests on the cubes behind it, so you only ever see whole cubes and whole faces. The field drifts slowly past.
- **Real cubes, real turns.** Every cube is a legal puzzle state: a solved cube put through its own scramble. Each one runs on its own clock. It makes three moves, each a single layer turn or a whole-cube tumble, rests, then undoes them in reverse. Sticker colours travel with the turning layers.
- **Workspaces turn the stack.** Every workspace switch rolls the whole stack 120 degrees with a flick-and-settle overshoot. That's the isometric view's own symmetry, so the pattern clicks back into line like a cube turn.
- **Your theme's colours.** The cubes take their sticker colours from your current Omarchy theme and crossfade when you switch themes. For the classic cube colours, pick the Omacube theme (below) in the theme switcher.

Everything is drawn by one GPU fragment shader. The plugin reads only your current theme's colours. It writes no files, runs no processes and makes no network connections. See [DISCLOSURE.md](DISCLOSURE.md).

## Install

```bash
omarchy plugin add https://github.com/Tiedeyez/omacube.git --enable
```

Omacube is a `service` plugin. When it's enabled it draws on every screen, on the layer just above your normal wallpaper and below your windows. Clicks pass straight through to the desktop.

## Remove

```bash
omarchy plugin disable tiedeyez.omacube
omarchy plugin remove tiedeyez.omacube
```

Your normal wallpaper shows again as soon as the plugin is disabled. Nothing else needs cleaning up, because the plugin writes no files.

## Colours

By default the cubes wear your current theme's colours. Each sticker takes the theme colour with the same role: red, orange, foreground (as the white face), yellow, green and blue, on the theme's background as plastic. Opposite faces stay opposite, so every cube is still a real cube state in any palette. When you switch themes, the colours crossfade.

### The classic cube: the Omacube theme

`theme/omacube/` is a matching Omarchy theme. Pick it in the theme switcher and the cubes turn back to the original red, orange, white, yellow, green and blue on black plastic. It also has a sticker-gradient window border, and "layer click" window and workspace animations: a fast flick, a small overshoot and a settle. Its workspace animation slides windows sideways while the stack turns.

The plugin doesn't install it for you. To add it to your theme switcher:

```bash
cp -r ~/.config/omarchy/plugins/tiedeyez.omacube/theme/omacube ~/.config/omarchy/themes/
omarchy theme set omacube
```

Omarchy only loads a theme's `hyprland.lua` (the animations and border) from a theme in your own themes folder, which is why the theme is copied rather than installed from git.

### For theme authors

A theme can set the cube's colours exactly with optional keys in its `colors.toml`. Omarchy ignores keys it doesn't know:

```toml
omacube_red = "#c41e3a"
omacube_orange = "#ff5800"
omacube_white = "#f4f4f4"
omacube_yellow = "#ffd500"
omacube_green = "#009e60"
omacube_blue = "#0051ba"
omacube_plastic = "#0b0b0d"
```

## Performance

- The shader renders at 75% of screen resolution and redraws 24 times a second. Both settings are at the top of `Service.qml`.
- It stops redrawing while a fullscreen window covers the screen.
- Any animated wallpaper makes the compositor repaint the whole screen on every frame, including blur behind translucent windows and any other animated overlays. On an RTX 4070 SUPER at 3440x1440, GPU power went from about 6.5 W to about 16.5 W with Omacube enabled on a quiet desktop. With other animated overlays running, the extra cost was higher, because the GPU clocked up. The shader itself is a small part of that: rendering it nonstop at about 60 fps on its own cost about 7 W. Expect a bigger relative cost on integrated graphics. On a weak GPU, lower `renderScale` and `fps` in `Service.qml`.
- The animation loops seamlessly: the cubes every 70 minutes, the drifting field every 12.8 hours. Nothing jumps when either loop wraps.

## How it's checked

[MATH.md](MATH.md) explains the maths: the isometric camera, the distance function that keeps the ray march from stepping through a turning cube, real cube states, timing, seamless loops, hashing and antialiasing. Two sets of checks back it up:

- `python3 tools/check-math.py` re-derives every claim in plain Python, using brute force where the shader takes shortcuts. It needs only the standard library.
- `node tools/check-palette.mjs` runs the plugin's own `Palette.js` against every installed theme.
- `dev/selfcheck.sh` builds debug versions of the shader and renders them on your GPU. Each check paints failing pixels magenta, then counts them. It needs a running Wayland session with Quickshell.

## Development

- `shaders/omacube.frag` is the shader source. `shaders/omacube.frag.qsb` is the compiled form Qt loads. Rebuild it with `tools/build-shader.sh` (needs `qt6-shadertools`).
- `dev/preview.sh [outdir] [frames] [fps] [t0] [width] [height] [qsb]` renders PNG frames without installing the plugin. Set `OMACUBE_THEME=/path/to/colors.toml` to render with a theme's colours.
- `node tools/check-palette.mjs` checks the theme-to-sticker mapping against every installed theme and shows a swatch for each.
- After editing `Service.qml`, run `omarchy restart shell`.

## Credits

Built by Tiedeyez. MIT licence. "Omacube" is an independent fan project and is not affiliated with any puzzle-cube trademark holder.
