# Shader build provenance

Omacube loads two compiled shaders: `omacube.frag.qsb`, the background, and `eggcube.frag.qsb`, the easter egg's floating cube (only while you play it). Each is built from the `.frag` of the same name in this folder by `tools/build-shader.sh`, and the build is reproducible: building the same source with the same qsb gives a byte-identical file.

| | |
|---|---|
| Source | `shaders/omacube.frag`, SHA-256 `314da6f0567dfee52b6118507576d922e8aeec1c156ceac33a4fe50a31a441d0` |
| Source and artifact last changed in | 0.4.0 (height map, rest cache, motion map, slides, theme wave, cube sizes, easter egg) |
| Tool | `/usr/lib/qt6/bin/qsb` 6.12.0, from Arch `qt6-shadertools 6.12.0-1` |
| Command | `qsb --glsl "100es,300es,120,150" --hlsl 50 --msl 12 -o shaders/omacube.frag.qsb shaders/omacube.frag` |
| Output | `shaders/omacube.frag.qsb`, SHA-256 `433c9a730ec2665dc6e63a83b74c1c3454dd1c366a7d89c869c74633354d67c3` |
| Second source | `shaders/eggcube.frag`, SHA-256 `5c3aecb7680c437046daa42b7fb76d4d2d1d4ba5d04f1ca1e9f5ffa754728929` |
| Second output | `shaders/eggcube.frag.qsb`, SHA-256 `2973069a70142d1745c80493e72b266cc823955075d724e884000ddea563b60c` (same tool and flags) |

## Check it yourself

```bash
tools/build-shader.sh /tmp/omacube-check.qsb
sha256sum shaders/omacube.frag.qsb /tmp/omacube-check.qsb   # the two hashes match
/usr/lib/qt6/bin/qsb --dump shaders/omacube.frag.qsb        # shows every variant's translated source
```

A different qsb version may translate the variants differently and give another hash. If you change `omacube.frag`, rebuild with `tools/build-shader.sh` and update this file.
