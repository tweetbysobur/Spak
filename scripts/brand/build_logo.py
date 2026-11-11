"""
Builds the SPak logo SVGs from scripts/brand/symbol-geometry.json (the vector reconstruction of
public/brand/references/spak-symbol-reference.png) and Sora SemiBold outlines.
Usage: python3 scripts/brand/build_logo.py <path-to-sora-latin-600-normal.woff2>
Needs: fonttools, brotli. Outputs into public/brand/logo and public/brand/icons.
"""
import json, os, sys
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.boundsPen import BoundsPen

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
GEOM = json.load(open(os.path.join(ROOT, 'scripts/brand/symbol-geometry.json')))
FOREST, WHITE, GRAPHITE, SAGE = '#174734', '#F7F6F0', '#222724', '#A7B7A9'
OX, OY = 313.89, 352.0               # symbol bounding box origin in reference pixels
SW, SH = 939.82 - OX, 903.0 - OY     # 625.93 x 551 (aspect 1.136)

def f(v):
    s = ('%.2f' % v).rstrip('0').rstrip('.')
    return '0' if s in ('-0', '') else s

def symbol_d(x=0.0, y=0.0, h=SH, small=False):
    """small=True drops the central leaf: optical-size version for 16-24 px only (the leaf cannot resolve there)."""
    s = h / SH; out = []
    for part in (('upper', 'lower') if small else ('upper', 'leaf', 'lower')):
        for c in GEOM[part]:
            if c[0] == 'Z': out.append('Z'); continue
            pts = [c[1]] if c[0] in 'ML' else c[1]
            out.append(c[0] + ' '.join(f'{f((p[0]-OX)*s+x)} {f((p[1]-OY)*s+y)}' for p in pts))
    return ''.join(out)

# Wordmark: Sora SemiBold outlines, tracking -20/1000, optical kerning on S-P and P-a.
TRACK = -20
KERN = {'SP': -6, 'Pa': -38, 'ak': -4}
def wordmark_d(font, cap_px, x=0.0, baseline=0.0):
    tt = TTFont(font); gs = tt.getGlyphSet(); cmap = tt.getBestCmap()
    s = cap_px / tt['OS/2'].sCapHeight; text = 'SPak'; cx = 0.0; parts = []; bp = BoundsPen(gs)
    for i, ch in enumerate(text):
        g = cmap[ord(ch)]; pen = SVGPathPen(gs, ntos=f)
        gs[g].draw(TransformPen(pen, (s, 0, 0, -s, cx, 0))); gs[g].draw(TransformPen(bp, (s, 0, 0, -s, cx, 0)))
        parts.append(pen.getCommands()); cx += (gs[g].width + TRACK + KERN.get(text[i:i+2], 0)) * s
    xmin, ymin, xmax, ymax = bp.bounds
    # second pass with the left side bearing removed so the wordmark starts exactly at x
    d = ''.join(parts)
    return d, xmin, xmax - xmin, -ymin, ymax  # d, left offset, width, height above baseline, overshoot below

def svg(w, h, body, title):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {f(w)} {f(h)}" width="{f(w)}" height="{f(h)}" role="img" aria-label="{title}">'
            f'<title>{title}</title>{body}</svg>\n')

def write(rel, text):
    p = os.path.join(ROOT, rel); os.makedirs(os.path.dirname(p), exist_ok=True); open(p, 'w').write(text); print('wrote', rel)

def main(font):
    H = 100.0                          # symbol height unit for all lockups
    W = SW * H / SH
    CAP = 0.45 * H                     # wordmark cap height = 0.45 x symbol height
    GAP = 0.30 * H                     # clear gap symbol -> wordmark
    wd, wl, ww, wup, wdown = wordmark_d(font, CAP)
    base = H / 2 + CAP / 2             # caps centred on the symbol's vertical centre
    def wm_path(color, x, b): return f'<path fill="{color}" transform="translate({f(x - wl)} {f(b)})" d="{wd}"/>'
    horiz_w = W + GAP + ww
    variants = {
        'logo/spak-logo-horizontal': (FOREST, GRAPHITE), 'logo/spak-logo-horizontal-dark': (SAGE, WHITE),
        'logo/spak-logo-horizontal-mono-graphite': (GRAPHITE, GRAPHITE), 'logo/spak-logo-horizontal-mono-white': (WHITE, WHITE),
        'logo/spak-logo-horizontal-mono-black': ('#000000', '#000000'),
    }
    for name, (sc, wc) in variants.items():
        write(f'public/brand/{name}.svg', svg(horiz_w, H, f'<path fill="{sc}" d="{symbol_d(0, 0, H)}"/>' + wm_path(wc, W + GAP, base), 'SPak'))
    for name, c in {'spak-symbol': FOREST, 'spak-symbol-dark': SAGE, 'spak-symbol-white': WHITE, 'spak-symbol-mono-graphite': GRAPHITE, 'spak-symbol-mono-black': '#000000'}.items():
        write(f'public/brand/logo/{name}.svg', svg(W, H, f'<path fill="{c}" d="{symbol_d(0, 0, H)}"/>', 'SPak symbol'))
    wh = wup + wdown
    for name, c in {'spak-wordmark': GRAPHITE, 'spak-wordmark-green': FOREST, 'spak-wordmark-dark': WHITE, 'spak-wordmark-mono-black': '#000000'}.items():
        write(f'public/brand/logo/{name}.svg', svg(ww, wh, wm_path(c, 0, wup), 'SPak'))
    # Stacked lockup (symbol over wordmark) for square placements
    SG = 0.28 * H; sw = max(W, ww); sh = H + SG + wh
    write('public/brand/logo/spak-logo-stacked.svg', svg(sw, sh, f'<path fill="{FOREST}" d="{symbol_d((sw-W)/2, 0, H)}"/>' + wm_path(GRAPHITE, (sw-ww)/2, H + SG + wup), 'SPak'))
    write('public/brand/logo/spak-logo-stacked-dark.svg', svg(sw, sh, f'<path fill="{SAGE}" d="{symbol_d((sw-W)/2, 0, H)}"/>' + wm_path(WHITE, (sw-ww)/2, H + SG + wup), 'SPak'))
    # App icon: Warm White symbol on a Forest Green rounded square (symbol width 62% of the tile)
    T = 512.0; iw = 0.62 * T; ih = iw * SH / SW
    tile = f'<rect width="{f(T)}" height="{f(T)}" rx="{f(T*0.225)}" fill="{FOREST}"/>'
    write('public/brand/icons/spak-app-icon.svg', svg(T, T, tile + f'<path fill="{WHITE}" d="{symbol_d((T-iw)/2, (T-ih)/2, ih)}"/>', 'SPak'))
    # Full-bleed square (for platforms that apply their own mask, e.g. maskable/Android, Apple touch)
    iw2 = 0.56 * T; ih2 = iw2 * SH / SW
    write('public/brand/icons/spak-app-icon-square.svg', svg(T, T, f'<rect width="{f(T)}" height="{f(T)}" fill="{FOREST}"/><path fill="{WHITE}" d="{symbol_d((T-iw2)/2, (T-ih2)/2, ih2)}"/>', 'SPak'))
    # Favicons: same tile, larger symbol (74%). favicon.svg and the 16 px raster use the small-size symbol (no leaf);
    # favicon-full.svg keeps the leaf for 32 px and up.
    iw3 = 0.74 * T; ih3 = iw3 * SH / SW
    tile3 = f'<rect width="{f(T)}" height="{f(T)}" rx="{f(T*0.2)}" fill="{FOREST}"/>'
    write('public/brand/icons/favicon.svg', svg(T, T, tile3 + f'<path fill="{WHITE}" d="{symbol_d((T-iw3)/2, (T-ih3)/2, ih3, small=True)}"/>', 'SPak'))
    write('public/brand/icons/favicon-full.svg', svg(T, T, tile3 + f'<path fill="{WHITE}" d="{symbol_d((T-iw3)/2, (T-ih3)/2, ih3)}"/>', 'SPak'))
    write('public/brand/logo/spak-symbol-small.svg', svg(W, H, f'<path fill="{FOREST}" d="{symbol_d(0, 0, H, small=True)}"/>', 'SPak symbol (small sizes)'))
    json.dump({'symbolHeight': H, 'symbolWidth': round(W, 2), 'capHeight': CAP, 'gap': GAP, 'wordmarkWidth': round(ww, 2), 'horizontalWidth': round(horiz_w, 2),
               'tracking': TRACK, 'kerning': KERN, 'font': 'Sora SemiBold 600 (SIL OFL 1.1), outlined'}, open(os.path.join(ROOT, 'scripts/brand/lockup-metrics.json'), 'w'), indent=1)

if __name__ == '__main__':
    main(sys.argv[1])
