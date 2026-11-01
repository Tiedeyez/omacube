#!/usr/bin/env node
// Check Palette.js, the theme-to-sticker mapping, against real themes.
// Loads the plugin's own Palette.js (not a copy), then:
//   - unit checks: odd input never yields anything but six valid colours,
//     and the Omacube theme maps to exactly the classic cube
//   - every theme folder given (default: all installed themes) is mapped and
//     printed with a colour swatch, flagging faces that are hard to tell apart
// Usage: node tools/check-palette.mjs [theme-dir ...]
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, "..", "Palette.js"), "utf8").replace(/^\.pragma library\s*$/m, "");
const P = {};
vm.runInNewContext(src + "\n;this.P = { CLASSIC, MIN_DISTANCE, parse, fromText, distance };", P);
const { CLASSIC, MIN_DISTANCE, parse, fromText, distance } = P.P;

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};
const valid = (p) => Array.isArray(p.stickers) && p.stickers.length === 6 &&
  [...p.stickers, p.plastic, p.empty].every((c) => /^#[0-9a-f]{6}$/.test(c));

// ---- unit checks -------------------------------------------------------------
check("empty or missing file falls back to the classic cube", JSON.stringify(fromText("")) === JSON.stringify(CLASSIC));
check("garbage falls back to the classic cube", JSON.stringify(fromText("\u0000ÿ not toml {{{")) === JSON.stringify(CLASSIC));
const huge = 'red = "#ff0000"\n'.repeat(200000) + 'blue = "#0000ff"\n';
check("only the first 64 KiB / 512 lines are read", parse(huge).blue === undefined);
check("CRLF, single quotes, spacing and comments", (() => {
  const k = parse('# red = "#000000"\r\n  red='+"'#AbCdEf'"+' # hot\r\nblue = "#123456789"\n');
  return k.red === "#abcdef" && k.blue === undefined;
})());
const classicToml = fs.readFileSync(path.join(here, "..", "theme", "omacube", "colors.toml"), "utf8");
check("the Omacube theme maps to exactly the classic cube",
  JSON.stringify(fromText(classicToml)) === JSON.stringify(CLASSIC));
check("omacube_* keys win over the ordinary palette",
  fromText('red = "#111111"\norange = "#222222"\nforeground = "#333333"\nyellow = "#444444"\n' +
           'omacube_red = "#abcdef"\n').stickers[0] === "#abcdef");
const rnd = (() => { let s = 7; return () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648); })();
let allValid = true;
for (let i = 0; i < 2000; i++) {
  const names = ["red", "orange", "yellow", "green", "blue", "foreground", "background", "cyan", "magenta", "accent", "color1", "color4"];
  let text = "";
  for (const n of names) if (rnd() < 0.7) text += `${n} = "#${Math.floor(rnd() * 16777216).toString(16).padStart(6, "0")}"\n`;
  allValid &&= valid(fromText(text));
}
check("2000 random palettes always give six valid colours", allValid);

// ---- every installed theme ---------------------------------------------------------
const dirs = process.argv.slice(2).length ? process.argv.slice(2) : [
  ...["/usr/share/omarchy/themes", path.join(process.env.HOME || "", ".config/omarchy/themes")]
    .filter((d) => fs.existsSync(d))
    .flatMap((d) => fs.readdirSync(d).map((t) => path.join(d, t)))];
const sw = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.substr(i, 2), 16));
  return `\x1b[48;2;${r};${g};${b}m   \x1b[0m`;
};
console.log("\ntheme                          red orange white yellow green blue  plastic  close pairs");
let themesValid = true;
for (const dir of dirs) {
  const file = path.join(dir, "colors.toml");
  if (!fs.existsSync(file)) continue;
  const p = fromText(fs.readFileSync(file, "utf8"));
  themesValid &&= valid(p);
  let close = 0;
  for (let i = 0; i < 6; i++) for (let j = i + 1; j < 6; j++) if (distance(p.stickers[i], p.stickers[j]) < MIN_DISTANCE) close++;
  const name = path.basename(dir).padEnd(30).slice(0, 30);
  console.log(`${name} ${p.stickers.map(sw).join(" ")}   ${sw(p.plastic)}      ${close || ""}`);
}
check("every installed theme maps to six valid colours", themesValid);
console.log(failures ? `\n${failures} check(s) failed` : "\nall palette checks passed");
process.exit(failures ? 1 : 0);
