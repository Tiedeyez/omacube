# Omacube

An animated desktop background for [Omarchy](https://omarchy.org): an endless dive into the corner of a 3x3 puzzle cube, where every corner piece is another whole cube, all the way down.

![Omacube](preview.png)

- **Infinite zoom.** The view falls forever into a cube corner. Each corner cubie is a cube one third the size, so the picture repeats at every level and the dive never ends.
- **Real layer turns.** Every cube scrambles itself with eight layer turns, rests, then plays the moves back and solves itself. Sticker colours travel with the turning layers, so what you see is a real puzzle state.
- **Workspaces twist the cube.** Moving to a higher workspace twists the view 120 degrees and dives one level deeper with a click-and-settle overshoot. Moving to a lower one twists back out.
- **A field of cubes.** Behind the main fractal, a sparse lattice of small cubes tumbles past.

Everything is drawn by one GPU fragment shader. The plugin reads no files, runs no processes and makes no network connections. See [DISCLOSURE.md](DISCLOSURE.md).

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

## Optional companion theme

`theme/omacube/` is a matching Omarchy theme. It has a black-plastic palette with the six sticker colours, a sticker-gradient window border, and "layer click" window and workspace animations: a fast flick, a small overshoot and a settle. It also turns on Omarchy's workspace slide animation, so windows slide sideways while the background twists.

The plugin doesn't install it for you. To use it:

```bash
cp -r ~/.config/omarchy/plugins/tiedeyez.omacube/theme/omacube ~/.config/omarchy/themes/
omarchy theme set omacube
```

Omarchy only loads a theme's `hyprland.lua` (the animations and border) from a theme in your own themes folder, which is why the theme is copied rather than installed from git.

## Performance

- The shader renders at 40% of screen resolution and redraws 24 times a second. Both settings are at the top of `Service.qml`.
- It stops redrawing while a fullscreen window covers the screen.
- Any animated wallpaper makes the compositor repaint the whole screen on every frame, including blur behind translucent windows. On an RTX 4070 SUPER at 3440x1440 that cost about 14 W more than a static wallpaper, and the shader's resolution made no measurable difference. Expect a bigger relative cost on integrated graphics. On a weak GPU, lower `renderScale` and `fps` in `Service.qml`.

## Development

- `shaders/omacube.frag` is the shader source. `shaders/omacube.frag.qsb` is the compiled form Qt loads. Rebuild it with `tools/build-shader.sh` (needs `qt6-shadertools`).
- `dev/preview.sh [outdir] [frames] [fps] [t0] [width] [height]` renders PNG frames without installing the plugin.
- After editing `Service.qml`, run `omarchy restart shell`.

## Credits

Built by Tiedeyez. MIT licence. "Omacube" is an independent fan project and is not affiliated with any puzzle-cube trademark holder.
