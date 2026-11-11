/**
 * Brand governance: the guidelines reference only real files and real tokens; the asset inventory matches the files on
 * disk byte for byte; approved assets are unchanged.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import colors from "@/design/colors.json";
import manifest from "../../public/brand/manifest.json";

const doc = readFileSync("docs/SPAK-BRAND-GUIDELINES.md", "utf8");
const sha = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));

describe("brand guidelines", () => {
  it("contains all nine required sections", () => {
    for (const h of ["## 1. Brand foundation", "## 2. Logo system", "## 3. Colour system", "## 4. Typography", "## 5. Imagery and art direction",
      "## 6. Graphic elements", "## 7. Digital applications", "## 8. Design governance", "## 9. Reference board"]) expect(doc).toContain(h);
  });
  it("every file path it names exists", () => {
    const paths = [...doc.matchAll(/`((?:public|src|docs|scripts)\/[^`\s]+?\.[a-z]+)`/g)].map((m) => m[1]);
    expect(paths.length).toBeGreaterThan(20);
    for (const p of paths) expect(existsSync(p), p).toBe(true);
  });
  it("every hex colour it names is a token in colors.json", () => {
    const tokens = new Set(JSON.stringify(colors).match(/#[0-9A-Fa-f]{6}/g)!.map((h) => h.toUpperCase()));
    for (const h of doc.match(/#[0-9A-Fa-f]{6}\b/g) ?? []) expect(tokens.has(h.toUpperCase()), h).toBe(true);
  });
  it("brand hub links to every authoritative document", () => {
    const hub = readFileSync("docs/SPAK-BRAND.md", "utf8");
    for (const d of ["SPAK-BRAND-GUIDELINES.md", "SPAK-LOGO-GUIDELINES.md", "SPAK-COLOUR-SYSTEM.md", "SPAK-TYPOGRAPHY.md", "SPAK-BRAND-ASSETS.md"]) expect(hub).toContain(d);
  });
  it("messaging honesty: hype words appear only inside prohibitions", () => {
    const lines = doc.split("\n").filter((l) => /\b(guaranteed|instant(ly)?|risk-free|zero fees|autonomous)\b/i.test(l));
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) expect(l, l).toMatch(/\b(not|never|no|Do not|Overpromising)\b/i);
  });
});

describe("asset inventory", () => {
  const files = walk("public/brand").filter((p) => !p.endsWith("manifest.json")).sort();
  it("lists exactly the files on disk", () => {
    expect(manifest.assets.map((a) => a.path).sort()).toEqual(files);
  });
  it("checksums and sizes match (regenerate with scripts/brand/build_inventory.py after an approved change)", () => {
    for (const a of manifest.assets) { expect(sha(a.path), a.path).toBe(a.sha256); expect(statSync(a.path).size, a.path).toBe(a.bytes); }
  });
  it("the approved reference image is the original upload", () => {
    expect(sha("public/brand/references/spak-symbol-reference.png")).toBe("791134a74d91c035b3f226ee98cae3dd1999b880bbe969474b38960726eb63f0");
  });
  it("the board only uses approved logo files and contains no copied logo artwork", () => {
    const html = readFileSync("public/brand/board/spak-brand-board.html", "utf8");
    const refs = [...html.matchAll(/(?:src|href)="\.\.\/(logo|icons)\/([^"]+)"/g)].map((m) => `public/brand/${m[1]}/${m[2]}`);
    expect(refs.length).toBeGreaterThan(10);
    for (const r of refs) expect(manifest.assets.find((a) => a.path === r)?.approved, r).toBe(true);
    const symbolPath = JSON.stringify(readFileSync("public/brand/logo/spak-symbol.svg", "utf8").match(/ d="([^"]{40})/)![1]);
    expect(html).not.toContain(JSON.parse(symbolPath)); // logo geometry is never pasted into the board
  });
});
