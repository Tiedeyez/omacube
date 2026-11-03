# Shader build provenance

`omacube.frag.qsb` is the only compiled file Omacube loads. It is built from `omacube.frag` in this folder by `tools/build-shader.sh`, and the build is reproducible: building the same source with the same qsb gives a byte-identical file.

| | |
|---|---|
| Source | `shaders/omacube.frag`, SHA-256 `049caac070081c87778f169fb1ee355ffa71a536c82ff36be5dab6c80d16ecaf` |
| Source and artifact last changed in | 0.4.0 (height map, rest cache, motion map) |
| Tool | `/usr/lib/qt6/bin/qsb` 6.12.0, from Arch `qt6-shadertools 6.12.0-1` |
| Command | `qsb --glsl "100es,300es,120,150" --hlsl 50 --msl 12 -o shaders/omacube.frag.qsb shaders/omacube.frag` |
| Output | `shaders/omacube.frag.qsb`, SHA-256 `1af6077e0273494db287654e8e93320b6b54ee546bebdc49da573e0ebca531ca` |

## Check it yourself

```bash
tools/build-shader.sh /tmp/omacube-check.qsb
sha256sum shaders/omacube.frag.qsb /tmp/omacube-check.qsb   # the two hashes match
/usr/lib/qt6/bin/qsb --dump shaders/omacube.frag.qsb        # shows every variant's translated source
```

A different qsb version may translate the variants differently and give another hash. If you change `omacube.frag`, rebuild with `tools/build-shader.sh` and update this file.
