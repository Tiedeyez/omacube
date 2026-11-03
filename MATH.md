# The maths behind Omacube

Omacube draws an endless stack of 3x3x3 puzzle cubes with one fragment shader, `shaders/omacube.frag`. This page explains each part of the maths and how it is checked. Two kinds of checks back it up:

- **`tools/check-math.py`** rebuilds every claim below from scratch in plain Python (standard library only), using brute force where the shader takes shortcuts. Run `python3 tools/check-math.py`.
- **`dev/selfcheck.sh`** builds debug versions of the real shader and renders them on your GPU. Each debug version paints any pixel that fails a check magenta, then counts those pixels.

## 1. The camera

The view is orthographic and looks straight down the cube diagonal, so the view direction is `fw = -(1,1,1)/√3`. The screen axes are `rt = (1,0,-1)/√2` and `up = (-1,2,-1)/√6`.

- These three vectors are orthonormal, and `rt × up = -fw` (it points at the viewer), so the picture is not mirrored.
- The three cube axes project to equal lengths, 120° apart: a true isometric projection.
- `+y` points straight up the screen, so a resting cube shows white on top.
- A workspace switch slides the camera along `rt` by one screen width (`2·VIEW·aspect` world units), with the windows. `rt` is perpendicular to `fw` and to `up`, so the slide is purely sideways on screen, and its coordinate sum is 0, so the camera stays the same height above the stack.

## 2. One cube

A cube is 27 cubies of half-size 0.5 on a unit grid, so it spans -1.5 to 1.5. Because neighbouring cubies touch, the nearest cubie to a point `q` is found by rounding to the grid and clamping to the cube: `clamp(round(q), -1, 1)`. A box's signed distance gives the distance to that cubie.

While a layer turns:

- The turning layer's cubies are measured in a frame rotated back by the turn angle.
- The cubies that stay put are measured with that layer excluded: the nearest remaining layer stands in for it.
- The distance to the cube is the smaller of the two.

`check-math.py` compares this against all 27 cubies placed explicitly, at 10,000 random points and random turns, including the ~10% overshoot. Outside the cube the two agree exactly (error 0), and points inside always read as inside.

## 3. The stack: whole faces only

Cubes sit on a lattice with pitch 3, so neighbours touch. Cells whose ids sum to more than 0 are empty, and cells below −3 are full. In the four layers between, each cell is switched on at random (chance 0.92). A cell holds a cube only if every cell of its *down-cone* inside those layers is switched on: the cells `id − (a, b, c)` with `a, b, c ≥ 0`.

That rule makes the stack a **down-set**: whenever a cell holds a cube, so do the cells behind it along −x, −y and −z. Seen down the diagonal, a down-set shows only whole faces, never pieces of one. The reason:

1. A face is exposed when the cell in front of it is empty.
2. Every cell that could cover any part of that face lies further along all three axes than that empty cell.
3. In a down-set, a cell further along than an empty cell is itself empty.

So nothing can cover part of an exposed face. The visible surface is a lozenge tiling: towers, staircases and hexagonal stars, made of whole cubes.

**This was a real bug.** The earlier version filled those top layers independently at random. That left cubes sitting over holes, and through the holes you saw faces cut diagonally: triangles. The evidence:

- In `check-math.py`, rays are cast toward the viewer from 25 points across every exposed face and tested exactly against every nearby cube. With the new rule, 0 of 257 exposed faces are partly covered. With the old fill, 45 of 413 were.
- On the GPU (self-check 6, with nothing turning), any visible pixel on a face that has a cube placed to cover part of it is marked: 0 such pixels with the new rule, 42,000–71,000 per frame with the old fill.

Where several cubes sit side by side in one plane, the sticker margin is a little wider on the sides where one cube meets the next, so each cube still reads on its own.

## 4. Why the march can't skip a cube

The shader finds the distance to the nearest cube by measuring 8 cells exactly: the cell containing the point, plus its neighbours on the sides the point is closest to.

The other cells need a bound. A turning cube reaches past its own cell, but no part of any cube is ever farther than `R = 1.5·√3 ≈ 2.598` from its centre, because rotations about the centre preserve distance. Any cell outside the 8 has its centre at least `3 + min|q₀|` from the point, where `q₀` is the point's position within its cell. So those cubes are at least `3 + min|q₀| − R` away, and the shader caps its answer at that.

With the cap, the estimate never exceeds the true distance. Sphere tracing moves along the ray by that estimate, so it can never jump through a cube.

**This was a real bug.** The earlier version measured the same 8 cells but had no cap. Part of a turning cube in a far cell could poke into reach unseen, and the ray stepped straight through it. That clipped turning cubes along straight lines. The evidence:

- In `check-math.py`, the old estimate was too large at about 0.8% of sample points, by up to 0.74 units. The new one is never too large, and is exact at 78% of points.
- On the GPU (self-check 1), the new shader compares its estimate with a brute-force 27-cell distance at every step of every ray: 0 failing pixels. The same check on the old scheme flags 6,000–20,000 pixels per frame.

Rays start just above the stack. With every cube in its cell, no cube point reaches above coordinate sum `R·√3 = 4.5`, and rays start at 4.6. Cubes slid out of the pile (see "Physics") are not part of this march; "Drawing it" explains how they are added.

A ray that runs alongside a face tumbled almost edge-on to the view moves in tiny steps. Typical rays hit in about 14 steps; the worst seen took about 220, so the budget is 256. If a ray still runs out within one pixel of a surface, it counts as a hit, since it's a silhouette pixel. Self-check 3 renders the step counts and finds no ray that runs out.

## 5. Real cube states

Every cube is a legal puzzle state: a solved cube put through its own scramble of 0–20 moves. A move is a quarter turn of one layer (-1, 0 or 1 on an axis) or of the whole cube, in either direction. No two consecutive moves share an axis, so a move never cancels the one before.

To colour a sticker, the shader takes the cubie's position and the face's normal, then undoes every move that has happened, newest first. That gives where the sticker started on the solved cube, and so its colour. Undoing a move uses exact whole-number quarter turns (`rot90`), not trigonometry, so nothing rounds.

`check-math.py` turns a solved cube physically, sticker by sticker, through 1,500 random move sequences, and compares the result with the undo method:

- every sticker matches
- every state has nine stickers of each colour
- every corner and edge piece is valid
- every cubie moves rigidly

The earlier version coloured stickers at random, which made every sampled cube impossible: for example, two whites on one corner.

On the GPU, self-check 4 undoes the moves for each visible cubie and confirms it is a rigid copy of one solved cubie: 0 failing pixels.

The colour scheme is the standard one: white opposite yellow, red opposite orange, green opposite blue. With white up and green in front, red is on the right.

## 6. Turning on time

Time is cut into windows of 9.975 s, and the three classes of cube (see "Physics") take them in turn: 0, 1, 2, 0, 1, 2, and so on. Once in each window of its class, at a random moment, a free cube makes a burst:

1. It slides out of the pile (0.33 s).
2. It makes three moves, one per move slot.
3. It rests for one slot, still out.
4. It undoes the three moves, newest first.
5. It slides back in (0.33 s).

A move slot lasts 0.95 s × m / 8 for a speed m in {6, …, 11} that each cube keeps, so the longest burst is 9.73 s and fits its window. Every burst brings three new moves. Outside a burst every cube rests at its base scramble.

- **Turn timing.** A move fills the first 60% of its slot. It follows a curve that starts at 0, overshoots about 10% (a ~99° flick) and settles at exactly 90°. Every slot ends with the cube at rest on the grid, so the step from one slot to the next changes nothing on screen.
- **Continuity.** `check-math.py` follows every cubie's position and orientation across every window edge, burst edge, slot edge and the clock wrap, for 400 random cubes: nothing ever jumps, and the slide out and back is continuous.
- **Shared moves.** The shape and the colours get their moves from the same function. Self-check 2 confirms on the GPU that the move being animated is always the move the colours will undo or apply: 0 failing pixels.

## 7. Loops with no seam

The shader works in 32-bit floats, so its clock has to wrap. The loop is arranged so that wrapping changes nothing on screen.

- **The cube loop: 4189.5 s (about 70 minutes).** That is exactly 420 class windows (140 per class). A cube's moves and burst moment depend on its window number modulo 140, so everything repeats exactly.
- **The field holds still.** The camera moves only with workspace switches, along `rt`, which is the lattice direction (3, 0, −3). Every cell's random choices come from its id modulo 1024 on each axis, and its class from `x − y` modulo 3. A slide of 3072 lattice steps shifts every cell id by 3072 × (1, 0, −1): the same values modulo 1024, the same layer and the same class. So the slide wraps there, every 3072 · 3√2 ≈ 13,033 units, with no jump.

`check-math.py` verifies the loop and the slide wrap exactly. Self-check 5 renders the picture at 2.37 s, then again one cube loop later and one slide wrap later, and compares them:

| Compared with the frame at 2.37 s | Pixels that differ |
|---|---|
| One cube loop later | 0.000% |
| One slide wrap later | 0.008% |
| An ordinary frame 1/24 s later | 1.3% |

The tiny remainder is float rounding, far below normal motion. Keeping the cube loop short keeps the shader's time precise to about half a millisecond.

## 8. Hashing

Every random choice comes from a hash of whole numbers: the cell id modulo 1024, a cube id, a cycle number, and a move index. All of them are small enough to be exact in a 32-bit float. The hash is Dave Hoskins' "Hash without Sine" (MIT). It uses no trigonometry, so it doesn't depend on how accurately a GPU computes `sin()`. It also doesn't magnify tiny rounding differences the way the common `fract(sin(x) × 43758.5)` does: there, a one-bit difference in `x` can change the result completely.

## 9. Edges

Sticker edges are antialiased over exactly one screen pixel. The projection is orthographic, so a one-pixel step on screen moves the hit point by a fixed amount within the face plane: `D = e − fw·(n·e)/(n·fw)`. The shader measures how much the sticker's edge distance changes over that step, and blends over it. This keeps lines equally sharp on all three face orientations and at any screen resolution. Colours blend in linear light and convert back to sRGB.

## 10. Portability

Qt may run the shader as GLSL ES 1.00 (it did on an NVIDIA driver). That version has no bitwise operators, and it doesn't guarantee indexing a vector with a variable. The shader avoids both. The package also includes GLSL ES 3.00, desktop GLSL 1.20 and 1.50, HLSL and Metal versions, so Qt can pick whichever matches the graphics API.

## 11. Colours from the theme

The sticker colours come from the active Omarchy theme, in `Palette.js`. Each sticker takes the theme colour with the same role:

| Sticker | Theme colour |
|---|---|
| red, orange | `red`, `orange` |
| white | `foreground` |
| yellow | `yellow` |
| green, blue | `green`, `blue` |
| plastic | `background` |

So opposite faces stay opposite, and every cube remains a legal state in any palette.

- **A colour used twice.** If a theme uses one colour for two roles, or two nearly identical ones, the later role borrows a spare colour from the same theme (cyan, magenta, accent, or a bright variant). Truly monochrome themes keep their own shades.
- **Exact colours.** A theme can set the cube's colours exactly with optional `omacube_*` keys, which Omarchy itself ignores. The Omacube theme uses them for the classic cube.
- **Theme switches.** The plugin re-reads the colours when `omarchy theme set` writes the new theme's name, and crossfades over 0.9 s.

`node tools/check-palette.mjs` runs the plugin's own `Palette.js` against every installed theme. It also checks odd input (empty, garbage, oversized, CRLF), 2,000 random palettes, and that the Omacube theme gives exactly the classic cube.

## 12. Resolution and pixel art

By default the background renders smooth at the screen's own resolution (`renderWidth: 0`). Setting `renderWidth: 6144` renders at 6K and scales to the screen with mipmapped filtering: on a 3440x1440 screen that is about 1.8x supersampling, for cleaner silhouettes on top of the per-pixel sticker antialiasing.

With `pixelSize` above 0 it is drawn as pixel art instead. Each art pixel covers exactly `pixelSize` screen pixels, with no blending, so the image uses only the theme's exact colours.

- **Exact size.** The shader renders into a texture of `ceil(screen size / pixelSize)` art pixels, which is shown with nearest-neighbour scaling. The canvas is sized in whole art pixels and centred, so it can overhang the screen edge by less than one art pixel. The screen size comes from the window's own scale factor (1.25 on a 3440x1440 screen at 125%). The screen object reports a rounded-up 2 instead, which rendering doesn't use.
- **Hard edges.** A pixel is either all sticker or all plastic: `step(sd, 0)` instead of the smooth one-pixel ramp.
- **Whole-pixel sliding.** As the camera slides on a workspace switch, its offset along `rt` is rounded to whole art pixels, so the picture moves by exact pixel steps and edges never shimmer.

Measured on an RTX 4070 SUPER at 3440x1440, whole-GPU power with the background showing: 6K smooth about 147 W (the GPU at full clock, 76% busy), native smooth about 48 W, pixel art at 4 about 16 W. The original shader, without the physics, drew about 38 W at native smooth (these figures included the since-removed word print).

## 13. Cube-face tiling

The Omacube theme tiles windows with a Hyprland Lua layout, `theme/omacube/cubeface.lua`. Each workspace is one 3x3 face, and its slots are numbered like stickers:

```
0 1 2
3 4 5
6 7 8
```

**Moves.** Each move is a permutation of the nine slots: a window in slot `s` moves to slot `move[s]`.

- A clockwise face turn sends position (row, column) to (column, 2 − row). In cycle notation that is (0 2 8 6)(1 5 7 3), and the centre stays put. A counter-clockwise turn is its inverse.
- A row turn sends (r, c) to (r, c ± 1 mod 3) for one row, which is a 3-cycle. A column turn does the same for one column.

**Tiling.** Rows and columns with no window collapse. The rest are split into equal parts, and each window spreads over the empty slots beside it in its row. Box edges are rounded once and shared, so neighbouring windows always meet exactly. New windows take the first free slot in the order 4, 5, 7, 8, 3, 6, 1, 0, 2, so 1–9 windows tile as 1, 2, 2+1, 2+2, 3+2, 3+3, 1+3+3, 2+3+3 and 3+3+3 per row.

**Parity.** A 4-cycle is an odd permutation, so a face turn (two 4-cycles) is even. A 3-cycle is even too, so every turn is an even permutation of the windows. Any sequence of turns is therefore even, and a single swap of two windows (odd) is unreachable. That's the same law that stops a real cube from swapping two pieces on their own.

`lua tools/check-cubeface.lua` checks all of this:

- every move is a permutation, and four face turns, or three row turns, give the identity
- the corner and edge cycles are exactly as above
- a face turn moves every window's box centre exactly by a 90° rotation about the face centre
- all 511 window arrangements cover the face exactly, with no gaps and no overlaps, on three screen sizes
- windows keep their slots as others come and go
- the arrivals give the shapes above
- a search of every reachable arrangement finds exactly the 181,440 even ones (half of 9!), so the turns generate the whole alternating group A₉, and the single swap is never reached

Hyprland names Lua layouts `lua:<name>` and registers each name only once per session. Omarchy re-runs a theme's Lua on every config reload, so the theme registers small wrappers once and points them at the newest copy of the module on each reload. Window places survive a reload.

## 14. Physics

Neighbouring cubes touch, and a turning layer's corners sweep out to 1.5·√2 ≈ 2.12 from its axis. So a cube that turns in place cuts into the cubes around it. `check-math.py` measures that on the previous version with an exact box-against-box test of every cubie: 144 colliding move, angle and neighbour cases.

Three rules make every motion collision-free.

- **Only free cubes move.** A cube is free when the three cells in front of it (+x, +y, +z) are empty. The stack is a down-set, so then every cell further along all three axes is empty too, and the cube has a clear path out. Top-layer cubes are always free. About 18% of visible cubes are free with the default fill; the rest stay put.
- **A free cube slides out before it turns.** It slides along (1,1,1) by `LIFT = 0.63` on each axis, turns only while fully out, and slides back between bursts. The least slide that clears every neighbour, for every move and every angle up to the 99° overshoot, is 3/√2 − 1.5 ≈ 0.6213 (`check-math.py` bisects it from the box test). (1,1,1) is the view direction, so the slide doesn't move the cube on screen.
- **Neighbours take turns.** Two free cubes side by side in one layer can still hit each other when both move (36 of 600 random pairs in the test). A cell's class is `(x − y) mod 3`. The six neighbours in a layer differ by (1,−1,0), (1,0,−1), (0,1,−1) and their negatives, which change `x − y` by ±1 or ±2, so a neighbour never shares a class. A cube moves only in its class's windows. Free cubes that aren't neighbours in a layer never collide, whatever each is doing (0 of 1,200 random pairs).

## 15. Drawing it

Sliding a cube along the view direction changes nothing about which point of it a ray hits; it only makes that point nearer, by `lift·√3`. `check-math.py` confirms it by tracing 300 random rays at turned cubes, slid and not: the same point every time, nearer by exactly `lift·√3` (error 2e-9).

So the shader doesn't march slid-out cubes at all. It marches the stack with every cube in its cell, turning layers included, using the fast distance bound of section 4. Then it checks the few cubes that can be out right now and cover the pixel. Each candidate:

1. lies in one of the cell columns `(i, j, 0) + n(1, 1, 1)` whose screen point is within R of the pixel;
2. has coordinate sum −4 or more (a free cube has an empty cell in front of it; before 0.4.0 this stopped at −3, so a free cube one layer deeper turned without being drawn slid out);
3. is of the class whose window it is;
4. is in a burst (only then is the free test run).

Each one is traced on its own. The nearest surface, march or candidate, after taking off `lift·√3`, is what the pixel shows.

Marching the slid-out stack directly would need a much smaller bound (`3 + min|q| − LIFT/2 − R`, as small as 0.087 against 0.402), and on the GPU it cost about 108 W against 48 W at native resolution. Self-check 8 keeps that direct march as a reference and compares the two on every sticker pixel: they agree, except for at most a pixel per frame on silhouettes where the two sample a depth edge differently. Self-check 3 shows the march back at about 13.5 steps per ray (the original averaged 13.9).

## 16. The monument

Here and there the corner of a giant solved cube rises out of the pile. Sites sit along the row direction (1, 0, −1), one per 32 cells (70% of them used), with the corner's apex `T` at y = 4 and coordinate sum 13, at a jittered spot along the row. Every cell at or behind `T` on all three axes is part of the giant cube: present, solved and still. That corner is a down-set, and a union of down-sets is a down-set, so faces stay whole (`check-math.py` checks the pile plus a corner). A solved cube shows white on top, red on the right and green on the left, so the giant cube's three faces are solid white, red and green.

The march starts each ray where it enters the corner's octant if that comes first, so rays above a monument don't crawl down through empty space.

## 17. The word: a sticker mosaic

OMARCHY is written on the red face in yellow, one sticker per pixel, in a 6 × 30 pixel font after the Omarchy wordmark: 10 cubes wide, 2 tall, one row of cubes below the top edge. The font is 6 rows, so letters fill exactly two rows of cubes.

The three faces meeting at a corner piece are always three different colours, so a real mosaic shows one face per cube. The text block starts one row below the giant top edge for the same reason: those cubes would otherwise have to keep an all-white top, and a centre sticker can only turn yellow if the whole cube turns.

`tools/build-mosaic.py` builds each of the 20 states.

1. It places real corner and edge pieces, each turned into its slot by a proper rotation, so a piece never shows a mirror-image colour order.
2. It tries the 24 whole-cube orientations, identity first.
3. It fixes the three invariants (corner twist, edge flip, permutation parity) with pieces nobody sees.
4. For the first column it keeps the +z face all green, flush with the giant left face.

`check-math.py` confirms the legality test itself: it accepts every state that up to 30 random turns reach, and rejects a single twisted corner, a single flipped edge and a single swapped pair. Then it checks all 20 states in `mosaic.png` and reads the word back from their stickers. The shader looks the colours up in `mosaic.png`: each sticker's position is undone back to the mosaic state, then the colour is read at that slot. Self-check 7 confirms on the GPU that the word at rest shows only yellow and red.

## 18. The word's motion

The word re-forms once per epoch of 119.7 s (35 per loop).

- **Classes.** A wall cube's class is (y mod 2, z mod 2). Neighbours on the wall differ in y or z parity, so they never share one, and two cubes of the same class are at least 6 apart, more than the 2R = 5.2 two turning cubes can reach.
- **Scramble.** From 99.7 s, each class in turn (5 s slots) pops straight out of the wall along +x by 3.05 (0.6 s), makes 8 random moves (0.4 s each), and pushes back in (0.6 s).
- **Solve.** At the start of the next epoch, each class in turn pops out again and undoes those 8 moves, so the word re-forms letter by letter.
- **Hold.** The word then stands for 80 s.

Each epoch's solve undoes the scramble the previous epoch made, so nothing jumps between epochs.

A popped cube must clear the wall around it. Popping 3 brings its back face level with the wall, and from there, `check-math.py`'s exact box test finds no collision for any move or angle; POP is 3.05. Sliding out and back only ever touches its neighbours' faces. Popped out, it clears every pile and monument cube near it, because every text cube has coordinate sum at least 2, so the space in front is empty.

Drawing a popped cube: the march leaves its cell empty, so the hole shows the giant cube behind it, and `main()` traces the cube at its popped spot. Self-check 8, framed on a monument, compares this with a direct march during the solve, the hold and the scramble: they agree except for a few silhouette pixels.


## 19. The height map

Section 3's cone rule says whether a cell holds a cube, but asking it costs up to 20 hashes (a cell's whole down-cone inside the four-layer band), and the march asks for up to eight cells at every step. On integrated graphics that was most of the frame: on an Intel HD 520, 0.3.3 drew 2 frames a second at 1600x900 with the GPU at full clock, and profiling put about three quarters of the frame in those lookups.

The stack is a down-set, so a cube in cell `id` means a cube in `id − (1,1,1)` too. Group the cells into columns along the view axis: column `(ci, cj) = (x − z, y − z)` holds the cells `(ci + n, cj + n, n)`. Down a column, cells hold cubes up to some top cell and are empty above it. One number per column, its top, describes the whole stack.

The cells with coordinate sum below −3.5 are always full; in column `(ci, cj)` the highest of them is `nBase = floor((−3.5 − ci − cj) / 3)`, exact because that fraction is never a whole number. Above it are at most two band cells, then only a monument's corner reaches higher (to `min(T.x − ci, T.y − cj, T.z)` for apex `T`). So the top is `nBase` plus a small whole number (at most 8), which fits in one byte.

A first pass of the same shader (`mapPass = 1`) writes that byte for every column on screen plus 5 on each side, one texel per column: about 60 by 45 texels at 16:9, worked out with the rule itself. It depends only on which columns are on screen, so it is redrawn only while the stack slides. The picture then answers "does this cell hold a cube?" with one texture read: `id.z <= top(id.x − id.z, id.y − id.z)`.

A ray only ever asks about cells within about 3 columns of its own spot, so every lookup lands inside the map. Self-check 9 runs the rule beside the map for every lookup the drawing makes and marks any disagreement: none. Self-check 9x reads the map one column off and fails, as it should. The picture is pixel-identical to 0.3.3 on the same GPU.

On the HD 520 at 1600x900 this took the frame from 2 to about 9 frames a second. (A fallback to the rule for off-map columns made the compiled shader larger and slower, so there is none; the margin makes it unnecessary.)

## 20. The rest cache and the motion map

Cubes take turns: at any moment only the free cubes of one class are mid-burst, and the word moves only a few minutes in every two. So nearly all of the picture is the same from frame to frame. The rest cache draws that unchanging part once and reuses it.

**Where a cube can change the picture.** A cube's every point is within R of its centre, and its centre slides only along the view axis, so on screen a cube stays inside the disc of radius R around its column's spot, whatever it does. A pixel outside every moving cube's disc sees exactly what it would see with every cube at rest. (A moving cube far from the ray can still change the length of a march step, and so the point within EPS of a surface where the march stops. That can shift the anti-aliasing of a sticker edge slightly, or, on a pixel right at a cube's edge, land it on the other side of that edge. It changes no colour otherwise.)

**The cache.** A second pass of the shader (`restPass = 1`) draws the picture with every cube at rest: no bursts, no slides, no pops, the word solved. It has no clock, so it is redrawn only when the camera, the colours or the size change. While the stack slides, while a theme crossfades, and for 150 ms after either, every pixel is drawn live instead.

**The motion map.** Each frame, a third tiny pass (`mapPass = 2`, the height map's layout) sets a texel for each column holding a cube mid-burst. Only a free cube moves, and a free cube has an empty cell in front of it, so its coordinate sum is at least −4: the column's two highest cells with sum at most 0 cover every candidate. It is the same test the slid-out cube drawing uses (section 15), once per column instead of once per pixel.

**Per pixel.** The picture reads the motion map for the columns whose spot is within `R + 1 px` of the pixel, at most nine. If a monument is in frame, it also checks the word's 20 cubes: one within reach, at home or anywhere on its way out along +x, that is popped out or not solved into the word, makes the pixel live. A live pixel is drawn exactly as before. Any other pixel is copied from the cache.

Typically 1–6% of the pixels are live; with a monument's word on screen while it scrambles, up to about 20%.

The checks:

- Self-check 11 builds the per-pixel test both ways, from the motion map and from the per-cell rule, and finds them identical on every frame.
- Self-check 10 renders each frame live and with the cache. It finds them identical except for edge pixels beside a moving cube: at most a few hundred pixels at 1600x900 (under 0.1%), mostly off by 1/255, at most about 25/255. At very low resolution, a single pixel on a cube's edge can show the face on the other side of that edge.

On the HD 520 at 1600x900, 24 frames a second now take the GPU about 78% busy at about 720 MHz, where the height map alone managed about 9 frames a second at full clock. Copying the cache and nothing else costs about 52% at 390 MHz, about what any full-screen animated background costs there, since the compositor repaints the screen every frame.
