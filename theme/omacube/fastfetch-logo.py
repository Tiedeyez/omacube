#!/usr/bin/env python3
"""Omacube fastfetch logo: a freshly scrambled isometric 3x3 cube on every run.

Prints truecolor half-block art (42x24 cells) to stdout. Sticker colours come from
the colors.toml beside this file (omacube_* keys, else the theme's red/orange/
foreground/yellow/green/blue). Reads only that file; writes nothing, starts no
processes, opens no network connections. Author: Tiedeyez
"""
import math, os, random, re, sys

def palette():
    keys = {}
    try:
        with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "colors.toml"), encoding="utf-8") as f:
            for line in f.read(65536).splitlines()[:512]:
                m = re.fullmatch(r'\s*([a-z_]+)\s*=\s*"#([0-9a-fA-F]{6})"\s*', line)
                if m: keys[m[1]] = tuple(int(m[2][i:i+2], 16) for i in (0, 2, 4))
    except OSError:
        pass
    def pick(name, fallback, default):
        return keys.get("omacube_" + name) or keys.get(fallback) or default
    return ({"W": pick("white", "foreground", (244,244,244)), "Y": pick("yellow", "yellow", (255,213,0)),
             "G": pick("green", "green", (0,158,96)),         "B": pick("blue", "blue", (0,81,186)),
             "R": pick("red", "red", (196,30,58)),            "O": pick("orange", "orange", (255,88,0))},
            pick("plastic", "background", (11,11,13)))

COL, EDGE = palette()
S, GAP, SS = 23.0, 0.13, 4
c30 = math.cos(math.radians(30))
UL=(-S*c30,-S/2); UR=(S*c30,-S/2); BOT=(0.0,S)
FACES = [(UL,UR,"W"), (UL,BOT,"G"), (UR,BOT,"R")]   # visible faces + fixed centre colours
# scramble: centres fixed, other 24 visible stickers drawn from the remaining 51 without replacement
pool = [c for c in COL for _ in range(9)]
for _,_,c in FACES: pool.remove(c)
random.shuffle(pool)
stick = []
for _,_,centre in FACES:
    f = [[None]*3 for _ in range(3)]
    for i in range(3):
        for j in range(3):
            f[i][j] = centre if (i,j)==(1,1) else pool.pop()
    stick.append(f)
def sample(x,y):
    for k,(u,v,_) in enumerate(FACES):
        det = u[0]*v[1]-u[1]*v[0]
        a = (x*v[1]-y*v[0])/det; b = (u[0]*y-u[1]*x)/det
        if -1e-9<=a<=1 and -1e-9<=b<=1:
            fa,fb = (a*3)%1,(b*3)%1
            if min(fa,1-fa)<GAP/2 or min(fb,1-fb)<GAP/2 or a>0.985 or b>0.985:
                return EDGE
            return COL[stick[k][min(int(a*3),2)][min(int(b*3),2)]]
    return None
W = int(math.ceil(2*S*c30))+2; H = int(2*S)+2
def pixel(px,py):
    hits={}; n=0
    for i in range(SS):
        for j in range(SS):
            c = sample(px-W/2+(i+.5)/SS, py-H/2+(j+.5)/SS)
            if c: hits[c]=hits.get(c,0)+1; n+=1
    return max(hits,key=hits.get) if n>=SS*SS/2 else None
grid=[[pixel(x,y) for x in range(W)] for y in range(H)]
fg=lambda c:f"\x1b[38;2;{c[0]};{c[1]};{c[2]}m"; bg=lambda c:f"\x1b[48;2;{c[0]};{c[1]};{c[2]}m"
out=[]
for y in range(0,H,2):
    line=""
    for x in range(W):
        t=grid[y][x]; b=grid[y+1][x] if y+1<H else None
        if t and b: line+=fg(t)+bg(b)+"▀\x1b[0m"
        elif t:     line+=fg(t)+"▀\x1b[0m"
        elif b:     line+=fg(b)+"▄\x1b[0m"
        else:       line+=" "
    out.append(line.rstrip())
sys.stdout.write("\n".join(out)+"\n")
