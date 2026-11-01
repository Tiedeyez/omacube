# The maths behind Omacube

Omacube draws an endless stack of 3x3x3 puzzle cubes with one fragment shader, `shaders/omacube.frag`. This page explains each part of the maths and how it is checked. Two kinds of checks back it up:

- **`tools/check-math.py`** rebuilds every claim below from scratch in plain Python (standard library only), using brute force where the shader takes shortcuts. Run `python3 tools/check-math.py`.
- **`dev/selfcheck.sh`** builds debug versions of the real shader and renders them on your GPU. Each debug version paints any pixel that fails a check magenta, then counts those pixels.

## 1. The camera

The view is orthographic and looks straight down the cube diagonal, so the view direction is `fw = -(1,1,1)/√3`. The screen axes are `rt = (1,0,-1)/√2` and `up = (-1,2,-1)/√6`.

- These three vectors are orthonormal, and `rt × up = -fw` (it points at the viewer), so the picture is not mirrored.
- The three cube axes project to equal lengths, 120° apart: a true isometric projection.
- `+y` points straight up the screen, so a resting cube shows white on top.
- Rolling the view by 120° about `fw` turns each lattice axis into another one, so a 120° roll lands the pattern back in line. Every workspace switch rolls by exactly that much.

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

Rays start just above the stack. No cube point reaches above coordinate sum `R·√3 = 4.5`, and rays start at 4.6.

A ray that runs alongside a face tumbled almost edge-on to the view moves in tiny steps. Typical rays hit in about 14 steps; the worst seen took about 217, so the budget is 256. If a ray still runs out within one pixel of a surface, it counts as a hit, since it's a silhouette pixel. Self-check 3 renders the step counts and finds no ray that runs out.

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

Each cube runs a 14-slot cycle: three moves, four slots of rest, the same three moves undone, four more slots of rest.

- **Turn timing.** A move fills the first 60% of its slot. It follows a curve that starts at 0, overshoots about 10% (a ~99° flick) and settles at exactly 90°. Every slot ends with the cube at rest on the grid, so the step from one slot to the next changes nothing on screen.
- **Continuity.** `check-math.py` checks all 14 slot boundaries over 1,000 random cubes, including the step into the next cycle's moves: the colours never jump.
- **Shared moves.** The shape and the colours get their moves from the same function. Self-check 2 confirms on the GPU that the move being animated is always the move the colours will undo: 0 failing pixels.
- **Rounding.** The slot position is computed with a division, which can round a hair outside `[0, 14)`. The shader folds it back in.

## 7. Loops with no seam

The shader works in 32-bit floats, so its clock has to wrap. Two loops are arranged so that wrapping changes nothing on screen.

- **The cube loop: 4189.5 s (about 70 minutes).** Each cube runs at a speed of m/8 with m in {6, 7, 8, 9, 10, 12}, so its cycle lasts 13.3 s × m / 8. Since lcm(6, 7, 8, 9, 10, 12) = 2520, the loop of 13.3 s × 2520 / 8 = 4189.5 s is a whole number of cycles at every speed. Each cube's moves depend on its cycle number modulo that count, so they also repeat exactly.
- **The drift loop: 46084.5 s, exactly 11 cube loops (about 12.8 hours).** The camera drifts along the lattice vector (3, 3, −6), which lies in the plane of the stack's top, so it stays the same height above the stack. Every cell's random choices come from its id modulo 1024 on each axis. One drift loop moves 1024 steps, which shifts every cell id by 1024 × (1, 1, −2): the same values modulo 1024, and the same layer.
- **Workspace turns** wrap the same way. The roll wraps every 3 turns (360°), and the half-step slide that goes with each turn wraps every 1024 lattice steps.

`check-math.py` verifies both loop lengths with exact fractions. Self-check 5 renders the picture at 0.5 s, then again one cube loop later and one drift loop later, and compares them:

| Compared with the frame at 0.5 s | Pixels that differ |
|---|---|
| One cube loop later | 0.011% |
| One drift loop later | 0.005% |
| An ordinary frame 1/24 s later | 6.7% |

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
