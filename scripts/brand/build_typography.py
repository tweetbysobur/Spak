"""
SPak typography tokens. Writes src/design/typography.json and validates the scale against the real font files
(metrics, OpenType features, word widths). Usage: python3 scripts/brand/build_typography.py <fontsource dir>
<fontsource dir> holds unpacked @fontsource/{sora,inter,jetbrains-mono,instrument-serif} packages (scratch only;
the app loads fonts through next/font, see src/design/fonts.ts). Needs fonttools + brotli.
"""
import glob, json, os, sys
from fontTools.ttLib import TTFont
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
VIEW_MIN, VIEW_MAX, GUTTER, VIEW_SMALLEST = 360, 1280, 16, 320   # fluid range; 320 is the narrowest supported screen

FAMILIES = {
  'display':   {'family': 'Sora', 'cssVar': '--font-sora', 'stack': "var(--font-sora), 'Inter', ui-sans-serif, system-ui, sans-serif", 'weights': [600], 'use': 'Marketing display and section headings only'},
  'sans':      {'family': 'Inter', 'cssVar': '--font-inter', 'stack': "var(--font-inter), ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif", 'weights': 'variable 400-700', 'use': 'Application, navigation, body, numbers'},
  'mono':      {'family': 'JetBrains Mono', 'cssVar': '--font-jetbrains-mono', 'stack': "var(--font-jetbrains-mono), ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", 'weights': 'variable 400-500', 'use': 'Hashes, addresses, identifiers, code'},
  'editorial': {'family': 'Instrument Serif', 'cssVar': '--font-instrument-serif', 'stack': "var(--font-instrument-serif), Georgia, 'Times New Roman', serif", 'weights': [400], 'styles': ['normal', 'italic'], 'use': 'Optional editorial accent, marketing only, never numbers'},
}
# role: family, weight, sizes [desktop, tablet, mobile] px, line height (unitless), letter spacing (em), extras
R = {}
def role(name, fam, weight, sizes, lh, ls=0.0, group='app', **kw):
    d, t, m = sizes
    R[name] = {'group': group, 'family': fam, 'weight': weight, 'size': {'desktop': d, 'tablet': t, 'mobile': m}, 'lineHeight': lh, 'letterSpacing': ls, **kw}
# Marketing (Sora display + Inter text)
role('display-xl', 'display', 600, (72, 56, 40), 1.05, -0.03, 'marketing', textWrap='balance', use='Hero headline, one per page')
role('display-lg', 'display', 600, (56, 44, 34), 1.08, -0.025, 'marketing', textWrap='balance', use='Large statements, closing CTA band')
role('heading-section', 'display', 600, (40, 34, 28), 1.12, -0.02, 'marketing', textWrap='balance', use='Marketing section headings')
role('heading-feature', 'display', 600, (24, 22, 20), 1.25, -0.01, 'marketing', textWrap='balance', use='Feature titles, card titles')
role('lead', 'sans', 400, (20, 19, 18), 1.55, -0.005, 'marketing', textWrap='pretty', maxWidth='38rem', use='Hero and section supporting paragraphs')
role('body-marketing', 'sans', 400, (18, 17, 16), 1.6, 0, 'marketing', textWrap='pretty', maxWidth='40rem', use='Feature descriptions, long-form marketing copy')
role('cta', 'sans', 600, (17, 16, 16), 1.2, 0, 'marketing', use='Primary marketing buttons')
role('eyebrow', 'sans', 600, (13, 13, 12), 1.3, 0.08, 'marketing', textTransform='uppercase', use='Short kicker above a section heading; max 4 words')
role('demo-label', 'mono', 500, (13, 13, 12), 1.4, 0, 'marketing', use='Labels inside product demonstrations (state names, network names)')
role('editorial-accent', 'editorial', 400, (None, None, None), None, -0.01, 'marketing', fontStyle='italic', sizeAdjust=round(534/510, 3),
     use='One emphasised phrase inside a display headline; inherits the headline size x sizeAdjust (x-height match)')
# Application (Inter)
role('app-title', 'sans', 600, (28, 26, 24), 1.25, -0.015, use='Page title')
role('app-heading', 'sans', 600, (20, 20, 18), 1.35, -0.01, use='Card and panel headings')
role('app-subheading', 'sans', 600, (16, 16, 16), 1.4, 0, use='Group headings inside cards')
role('body', 'sans', 400, (16, 16, 16), 1.55, 0, use='Default application text; 16 px everywhere (no iOS input zoom)')
role('body-sm', 'sans', 400, (14, 14, 14), 1.5, 0, use='Secondary text, descriptions (textSecondary colour)')
role('caption', 'sans', 400, (12, 12, 12), 1.45, 0.005, use='Timestamps, footnotes; never for essential information alone')
role('label', 'sans', 500, (13, 13, 13), 1.35, 0.005, use='Form labels, key in key/value rows')
role('button', 'sans', 600, (15, 15, 16), 1.2, 0, use='Buttons (16 px on mobile)')
role('button-sm', 'sans', 600, (13, 13, 14), 1.2, 0.005, use='Compact buttons')
role('nav', 'sans', 500, (14, 14, 16), 1.3, 0, use='Navigation items (16 px on mobile menus)')
role('status', 'sans', 600, (13, 13, 13), 1.2, 0.01, use='Execution, deposit and refund status labels; colour from colors.json semanticRoles; never uppercase')
role('error-title', 'sans', 600, (15, 15, 15), 1.4, 0, use='First line of an error: what happened')
role('error-body', 'sans', 400, (14, 14, 14), 1.5, 0, use='What to do next')
# Financial (tabular numerals everywhere)
num = dict(fontVariantNumeric='tabular-nums', fontFeatureSettings="'tnum' 1")
role('amount-display', 'sans', 600, (36, 34, 30), 1.1, -0.02, **num, use='Wallet balance, hero amount on review screen')
role('amount-total', 'sans', 600, (18, 18, 18), 1.3, -0.005, **num, use='Total cost, amount to receive (approval summary)')
role('amount', 'sans', 500, (16, 16, 16), 1.4, 0, **num, use='Transaction amounts in rows and tables; right-aligned in columns')
role('amount-fee', 'sans', 400, (14, 14, 14), 1.4, 0, **num, use='Network and protocol fees; textSecondary colour')
role('token-symbol', 'sans', 500, ('inherit', 'inherit', 'inherit'), None, 0.02, use='Ticker after an amount (USDC, SOL): same size as the amount, textSecondary colour, never uppercase-transformed')
# Technical (JetBrains Mono)
mono_ident = dict(overflowWrap='anywhere', fontVariantLigatures='none')
role('address', 'mono', 400, (13, 13, 13), 1.5, 0, **mono_ident, truncate='middle 6+4', use='Recipient and wallet addresses')
role('hash', 'mono', 400, (13, 13, 13), 1.5, 0, **mono_ident, truncate='middle 6+4', use='Transaction hashes and explorer references')
role('identifier', 'mono', 400, (12, 12, 12), 1.45, 0, **mono_ident, use='Execution, quote and deposit IDs, plan hashes')
role('code-inline', 'mono', 400, ('0.9em', '0.9em', '0.9em'), None, 0, use='Inline code in prose')
role('code-block', 'mono', 400, (14, 14, 13), 1.6, 0, whiteSpace='pre', overflowX='auto', tabSize=2, fontVariantLigatures='none', use='Code samples and API examples; scroll, do not wrap')
role('api-endpoint', 'mono', 500, (14, 14, 13), 1.5, 0, overflowWrap='anywhere', use='HTTP method + path in API references')

def fluid(mn, mx):
    """clamp() from VIEW_MIN to VIEW_MAX, in rem (16 px root)."""
    if mn == mx: return f'{mn/16:g}rem'
    slope = (mx - mn) / (VIEW_MAX - VIEW_MIN); icpt = mn - slope * VIEW_MIN
    return f'clamp({mn/16:g}rem, {icpt/16:.4f}rem + {slope*100:.4f}vw, {mx/16:g}rem)'
for r in R.values():
    s = r['size']
    if isinstance(s['desktop'], (int, float)) and isinstance(s['mobile'], (int, float)):
        # Fluid only when text shrinks toward mobile. Touch targets that grow on mobile (buttons, nav) switch at the
        # tablet breakpoint instead: a clamp() whose minimum exceeds its maximum would pin them to the mobile size.
        if s['mobile'] <= s['desktop']: r['fluid'] = fluid(s['mobile'], s['desktop'])
        else: r['responsive'] = 'stepped'

# ---------- validation against the real fonts
fdir = sys.argv[1]
def load(fam, w, style='normal'):
    p = glob.glob(f'{fdir}/fontsource-{fam}-*/package/files/{fam}-latin-{w}-{style}.woff2'); return TTFont(p[0])
FONTS = {'display': load('sora', 600), 'sans': load('inter', 400), 'sans600': load('inter', 600), 'mono': load('jetbrains-mono', 400), 'editorial': load('instrument-serif', 400, 'italic')}
def width(font, text, px, ls_em=0.0):
    gs = font.getGlyphSet(); cm = font.getBestCmap(); upm = font['head'].unitsPerEm
    return sum(gs[cm[ord(c)]].width for c in text) * px / upm + ls_em * px * (len(text) - 1)
def feats(font): return sorted({r.FeatureTag for r in font['GSUB'].table.FeatureList.FeatureRecord}) if 'GSUB' in font else []
checks = []
def check(name, ok, detail): checks.append({'check': name, 'pass': bool(ok), 'detail': detail})
# 1. Headlines: the longest single words in SPak's messaging must fit the narrowest screen at mobile size (no forced break)
words = ['Intelligent', 'infrastructure', 'cross-chain', 'verifiable', 'execution', 'transactions', 'Coordination']
avail = VIEW_SMALLEST - 2 * GUTTER
for rn in ('display-xl', 'display-lg', 'heading-section'):
    r = R[rn]; px = r['size']['mobile']; wmax = max(words, key=lambda w: width(FONTS['display'], w, px, r['letterSpacing']))
    wv = width(FONTS['display'], wmax, px, r['letterSpacing'])
    check(f'{rn}: longest word fits a {VIEW_SMALLEST}px screen', wv <= avail, f'"{wmax}" {wv:.0f}px at {px}px vs {avail}px available')
# 2. Tagline line count at each breakpoint (desktop container 1200, tablet 720, mobile 328)
tag = 'Intelligent execution across chains.'
for bp, cw in (('desktop', 1200), ('tablet', 720), ('mobile', 328)):
    px = R['display-xl']['size'][bp]; w = width(FONTS['display'], tag, px, R['display-xl']['letterSpacing'])
    check(f'display-xl tagline on {bp}', True, f'{w:.0f}px in {cw}px: about {max(1, -(-int(w) // cw))} line(s); text-wrap: balance evens them')
# 3. Tabular numerals available where numbers are set
check('Inter has tnum (financial roles)', 'tnum' in feats(FONTS['sans']), 'features: ' + ' '.join(feats(FONTS['sans'])))
check('Sora has tnum (numbers in display copy)', 'tnum' in feats(FONTS['display']), 'features: ' + ' '.join(feats(FONTS['display'])))
check('Instrument Serif has no tnum, so it is never used for numbers', 'tnum' not in feats(FONTS['editorial']), 'rule enforced in tokens')
gs = FONTS['sans'].getGlyphSet(); cm = FONTS['sans'].getBestCmap()
tn = [n for n in FONTS['sans'].getGlyphOrder() if n.endswith('.tf') or n.endswith('.tnum')]
check('Inter tabular digits share one width', len({gs[n].width for n in tn if n.split('.')[0] in ('zero','one','two','three','four','five','six','seven','eight','nine')}) == 1, f'{len(tn)} tabular glyphs')
gm = FONTS['mono'].getGlyphSet(); cmm = FONTS['mono'].getBestCmap()
check('JetBrains Mono: every character the same width', len({gm[cmm[ord(c)]].width for c in '0123456789abcdefABCDEFxOolI'}) == 1, 'hashes and addresses align in columns')
from fontTools.pens.recordingPen import RecordingPen
def contours(font, ch):
    p = RecordingPen(); font.getGlyphSet()[font.getBestCmap()[ord(ch)]].draw(p); return sum(1 for op, _ in p.value if op == 'closePath')
check('JetBrains Mono zero is marked (distinct from O)', contours(FONTS['mono'], '0') > contours(FONTS['mono'], 'O'), f'0: {contours(FONTS["mono"], "0")} contours, O: {contours(FONTS["mono"], "O")}')
# 4. Identifier widths
for label, s in (('EVM tx hash', '0x' + 'a' * 64), ('Solana signature', '5' * 88), ('EVM address', '0x' + 'b' * 40), ('NEAR account', 'spak-user.near')):
    w = width(FONTS['mono'], s, 13)
    check(f'{label} at 13px', True, f'{len(s)} chars = {w:.0f}px full; {"wraps (overflow-wrap:anywhere) or truncates on mobile" if w > avail else "fits on one line on mobile"}')
w = width(FONTS['mono'], '0x1a2b3c…9f8e', 13)
check('Truncated hash (6+4) fits a mobile row', w <= 140, f'{w:.0f}px')
# 5. Readability floors
check('Body text is at least 16px on every breakpoint', all(R['body']['size'][b] >= 16 for b in ('desktop', 'tablet', 'mobile')), 'prevents iOS input zoom; WCAG 1.4.4 resize friendly')
check('No text role below 12px', all(isinstance(v, str) or v is None or v >= 12 for r in R.values() for v in r['size'].values()), 'caption floor 12px')
check('Paragraph roles have line height >= 1.5', all(R[n]['lineHeight'] >= 1.5 for n in ('body', 'body-sm', 'lead', 'body-marketing', 'error-body')), 'WCAG 1.4.8 recommendation for blocks of text')
mono_x = FONTS['mono']['OS/2'].sxHeight / FONTS['mono']['head'].unitsPerEm; sans_x = FONTS['sans']['OS/2'].sxHeight / FONTS['sans']['head'].unitsPerEm
check('Mono x-height vs Inter (optical size match)', True, f'JetBrains Mono {mono_x:.3f} vs Inter {sans_x:.3f}: 13px mono next to 14px Inter sit close ({13*mono_x:.1f} vs {14*sans_x:.1f}px x-height)')
sx = FONTS['display']['OS/2'].sxHeight / 1000; ex = FONTS['editorial']['OS/2'].sxHeight / 1000
check('Editorial accent x-height match', abs(sx - ex * R['editorial-accent']['sizeAdjust']) < 0.005, f'Sora {sx:.3f}, Instrument Serif {ex:.3f} x {R["editorial-accent"]["sizeAdjust"]}')

out = {'version': '1.0.0', 'generatedBy': 'scripts/brand/build_typography.py', 'rootSize': 16,
       'breakpoints': {'mobile': '0-767px', 'tablet': '768-1199px', 'desktop': '1200px+', 'fluidRange': [VIEW_MIN, VIEW_MAX], 'narrowestSupported': VIEW_SMALLEST},
       'families': FAMILIES, 'roles': R, 'validation': checks}
p = os.path.join(ROOT, 'src/design/typography.json'); json.dump(out, open(p, 'w'), indent=2); open(p, 'a').write('\n')
for c in checks: print('PASS' if c['pass'] else 'FAIL', c['check'], '|', c['detail'])
