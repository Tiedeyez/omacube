# Omacube

Your Omarchy desktop as a 3x3 puzzle cube. Omacube is an animated background: an endless isometric stack of 3x3 cubes that turn their layers and tumble, where here and there a giant cube made of cubes rises out of the pile and spells OMARCHY in its stickers. Its companion theme tiles your windows on a 3x3 cube face, and they move by real cube turns.

![Omacube](preview.png)

- **An endless stack.** The view looks straight down a cube's diagonal at an infinite pile of cubes stacked into towers, staircases and hexagonal stars. Every cube rests on the cubes behind it, so you only ever see whole cubes and whole faces.
- **Real cubes, real turns.** Every cube is a legal puzzle state: a solved cube put through its own scramble. A cube makes three moves, each a single layer turn or a whole-cube tumble, rests, then undoes them in reverse. Sticker colours travel with the turning layers.
- **Real physics.** Nothing ever passes through anything. Only cubes with nothing in front of them can move; each slides out of the pile, towards you, far enough that its turning layers clear every neighbour, and settles back afterwards. Neighbours take turns, so two never collide.
- **The cubes spell Omarchy.** Here and there the corner of a giant solved cube, built from the same cubes, rises out of the pile: white top, red right face, green left face. On its red face, OMARCHY is a sticker mosaic in yellow, the way people build pictures out of real puzzle cubes: every pixel is one sticker, across 20 cubes that are each a legal cube state. Every two minutes those cubes take turns popping out of the wall, scramble, push back in, then pop out again and turn back into the word.
- **6K.** It renders at 6144 pixels across and scales down to your screen, for clean edges. Pixel art (hard pixels in your theme's exact colours) is one setting away, and far lighter on the GPU.
- **Workspaces slide the stack.** Every workspace switch slides the field one screen width sideways, with your windows, on the same flick-and-settle curve.
- **Your theme's colours.** The cubes take their sticker colours from your current Omarchy theme and crossfade when you switch themes. For the classic cube colours, pick the Omacube theme in the theme switcher.
- **Cube-face tiling** (with the Omacube theme). Each workspace is a 3x3 cube face. Windows tile into it like stickers and move by real face turns and layer turns.

The plugin is one GPU fragment shader. It reads only your current theme's colours and its own mosaic data, writes no files, runs no processes and makes no network connections. See [DISCLOSURE.md](DISCLOSURE.md).

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

## The Omacube theme

`theme/omacube/` is a matching Omarchy theme. Pick it in the theme switcher and you get:

- the original cube colours: red, orange, white, yellow, green and blue on black plastic
- cube-face tiling for your windows
- "layer click" animations: a fast flick, a small overshoot and a settle
- a freshly scrambled cube as your fastfetch logo on every run (`fastfetch-logo.py`, opt-in; see below)

The plugin doesn't install the theme for you. To add it to your theme switcher:

```bash
cp -r ~/.config/omarchy/plugins/tiedeyez.omacube/theme/omacube ~/.config/omarchy/themes/
omarchy theme set omacube
```

Omarchy only loads a theme's Lua files (the tiling, animations and border) from a theme in your own themes folder, which is why the theme is copied rather than installed from git. Switch to any other theme and Hyprland's normal tiling comes straight back.

### How windows tile

Each workspace is one face of a 3x3 cube. Its nine slots are numbered like the face's stickers, row by row (0 1 2 / 3 4 5 / 6 7 8).

- A new window takes the first free slot, starting from the centre. One window fills the face, two sit side by side, three are two over one, four make a 2x2 grid, six a 2x3 grid and nine the full 3x3 face.
- Rows and columns with no window collapse, and a window spreads over the empty slots beside it in its row, so the windows always cover the face.
- Window sizes come from the face's thirds, so resize keys don't apply. Floating and fullscreen windows work as usual.

### Cube turns

| Keys | Turn |
|---|---|
| SUPER + ALT + R | Turn the face clockwise: the corners cycle, the edges cycle, the centre stays |
| SUPER + ALT + SHIFT + R | Turn the face counter-clockwise |
| SUPER + CTRL + ALT + LEFT / RIGHT | Turn the focused window's row one slot along (it wraps round) |
| SUPER + CTRL + ALT + UP / DOWN | Turn the focused window's column |

The turns obey the same law as a real cube. Every turn is an even permutation of the slots, so you can reach every even arrangement of your windows (181,440 of them) but never swap just two windows, just as a real cube can't swap two pieces on their own.

### How workspace switches work

Switching workspace slides your windows sideways with the theme's flick-and-settle curve (420 ms). The background slides with them, one screen width in the direction you moved, on the same curve, so each workspace sits over its own stretch of the stack.

### Fastfetch logo

`theme/omacube/fastfetch-logo.py` prints a 42x24 isometric cube in truecolor half-blocks, scrambled anew each run, in the theme's sticker colours. Omarchy copies it along with the theme, but fastfetch won't use it until you point its logo at it. In `~/.config/fastfetch/config.jsonc`:

```jsonc
"logo": {
  "type": "command-raw",
  "source": "python3 -I ~/.local/state/omarchy/current/theme/fastfetch-logo.py",
  "width": 42,
  "height": 24
}
```

That path only exists while the Omacube theme is active, so with another theme the logo comes up empty. To fall back to another logo, point `source` at a small script that runs this file only when it exists.

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

## Settings

At the top of `Service.qml`:

- `renderWidth` (default 6144) sets how many pixels across the background renders before it is scaled to your screen. 0 renders at your screen's own resolution.
- `pixelSize` (default 0) switches to pixel art when above 0: each art pixel covers that many screen pixels, with hard edges in your theme's exact colours.
- `fps` (default 24) sets how many times a second the background redraws.

After editing `Service.qml`, run `omarchy restart shell`.

## Performance

Measured as whole-GPU power with the background showing, on an RTX 4070 SUPER at 3440x1440:

| Setting | GPU power |
|---|---|
| 6K, the default (`renderWidth: 6144`) | about 147 W, GPU at full clock and 76% busy |
| Your screen's resolution (`renderWidth: 0`) | about 48 W |
| Pixel art (`pixelSize: 4`) | about 16 W, GPU at idle clocks |

- 6K is heavy. It keeps the GPU at full clock while the desktop is visible, and it leaves less GPU for anything else running on it, such as local AI models or games. `renderWidth: 0` looks nearly the same on most screens at a third of the power.
- It stops redrawing while a fullscreen window covers the screen.
- Any animated wallpaper makes the compositor repaint the screen on every frame. On integrated graphics, use pixel art.
- The animation loops seamlessly every 70 minutes, and the workspace slide wraps without a jump.

## How it's checked

[MATH.md](MATH.md) explains the maths behind every part, and these checks back it up:

- `python3 tools/check-math.py` re-derives every claim about the background in plain Python, using brute force where the shader takes shortcuts.
- `lua tools/check-cubeface.lua` checks the tiling. It covers every turn, all 511 window arrangements on three screen sizes, the geometry of a face turn, and the whole group of reachable arrangements.
- `node tools/check-palette.mjs` runs the plugin's own `Palette.js` against every installed theme.
- `dev/selfcheck.sh` builds debug versions of the shader and renders them on your GPU. Each check paints failing pixels magenta, then counts them. One compares the fast way of drawing slid-out cubes with marching them directly. It needs a running Wayland session with Quickshell.

## Development

- `shaders/omacube.frag` is the shader source. `shaders/omacube.frag.qsb` is the compiled form Qt loads. Rebuild it with `tools/build-shader.sh` (needs `qt6-shadertools`).
- `dev/preview.sh [outdir] [frames] [fps] [t0] [width] [height] [qsb]` renders PNG frames without installing the plugin. Set `OMACUBE_THEME=/path/to/colors.toml` for a theme's colours, `OMACUBE_PIXEL=1` for pixel art (render at the art-pixel size, then upscale with nearest neighbour), and `OMACUBE_PAN=<units>` to move the camera sideways.
- `tools/build-mosaic.py` rebuilds `mosaic.png`, the 20 cube states that spell the word, and prints the word as their stickers show it.
- `dev/sticker-window.sh <n> [hex]` opens a demo window that looks like a cube sticker, for trying out the tiling.

## Credits

Built by Tiedeyez. MIT licence. "Omacube" is an independent fan project and is not affiliated with any puzzle-cube trademark holder.
