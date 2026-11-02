# Shader build provenance

`omacube.frag.qsb` is the only compiled file Omacube loads. It is built from `omacube.frag` in this folder by `tools/build-shader.sh`, and the build is reproducible: building the same source with the same qsb gives a byte-identical file.

| | |
|---|---|
| Source | `shaders/omacube.frag`, SHA-256 `5e552e52f341cbcfb76a89e2f08909c8f9fd70d8d4b609954e71e4f904d61ee5` |
| Source and artifact last changed in | commit `a2563fe` (0.3.0); unchanged since |
| Tool | `/usr/lib/qt6/bin/qsb` 6.12.0, from Arch `qt6-shadertools 6.12.0-1` |
| Command | `qsb --glsl "100es,300es,120,150" --hlsl 50 --msl 12 -o shaders/omacube.frag.qsb shaders/omacube.frag` |
| Output | `shaders/omacube.frag.qsb`, SHA-256 `9ff9d92945de65b020c9e7c22426db6c7ca188a71c2bbf862e9da19399154efe` |

## Check it yourself

```bash
tools/build-shader.sh /tmp/omacube-check.qsb
sha256sum shaders/omacube.frag.qsb /tmp/omacube-check.qsb   # the two hashes match
/usr/lib/qt6/bin/qsb --dump shaders/omacube.frag.qsb        # shows every variant's translated source
```

A different qsb version may translate the variants differently and give another hash. If you change `omacube.frag`, rebuild with `tools/build-shader.sh` and update this file.
