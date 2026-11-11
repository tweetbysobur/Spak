"""
Builds the SPak brand reference board (public/brand/board/spak-brand-board.html) from the approved assets and
token files. Logos are referenced as files (never redrawn); colours and type come from src/design/*.json.
Usage: python3 scripts/brand/build_board.py
"""
import json, os
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
C = json.load(open(os.path.join(ROOT, 'src/design/colors.json'))); T = json.load(open(os.path.join(ROOT, 'src/design/typography.json')))
B, S, L, D = C['brand'], C['semantic'], C['themes']['light'], C['themes']['dark']
def ratio(a, b):
    def lum(h):
        r, g, bb = [int(h[i:i+2], 16) / 255 for i in (1, 3, 5)]; f = lambda c: c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(bb)
    x, y = sorted([lum(a), lum(b)], reverse=True); return (x + 0.05) / (y + 0.05)
LOGO = '../logo/'; ICON = '../icons/'
# Status icons: 24px grid, 1.75 stroke, round joins; diagonals at the symbol's 51.8 degree family where they occur
ICONS = {
  'success':    '<path d="M5 12.5l4.2 4.2L19 7"/>',
  'refunded':   '<path d="M9 7L5 11l4 4"/><path d="M5 11h9a5 5 0 0 1 0 10h-2"/>',
  'error':      '<circle cx="12" cy="12" r="8"/><path d="M9 9l6 6M15 9l-6 6"/>',
  'warning':    '<path d="M12 4l9 16H3z"/><path d="M12 10v4.5M12 17.2v.1"/>',
  'pending':    '<circle cx="12" cy="12" r="8"/><path d="M12 7.5V12l3 2"/>',
  'processing': '<path d="M19 12a7 7 0 1 1-2.05-4.95"/><path d="M19 4.5V8h-3.5"/>',
  'info':       '<circle cx="12" cy="12" r="8"/><path d="M12 11v5M12 8v.1"/>',
  'neutral':    '<circle cx="12" cy="12" r="8"/><path d="M8.5 12h7"/>',
}
STATES = [('Completed', 'success'), ('Refunded', 'refunded'), ('Failed', 'error'), ('Unknown or delayed', 'warning'),
          ('Awaiting deposit', 'pending'), ('Verifying delivery', 'processing'), ('Network notice', 'info'), ('Cancelled', 'neutral')]
def icon(role, color, size=18):
    return f'<svg width="{size}" height="{size}" viewBox="0 0 24 24" fill="none" stroke="{color}" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{ICONS[role]}</svg>'
def badge(label, role, theme):
    s = S[role][theme]
    return f'<span class="badge" style="color:{s["foreground"]};background:{s["background"]};border-color:{s["border"]}">{icon(role, s["icon"], 16)}{label}</span>'

def swatch(name, hexv, text, note):
    return f'<div class="sw"><div class="chip" style="background:{hexv};color:{text}"><span>{name}</span><code>{hexv}</code></div><p>{note}</p></div>'

brand_sw = ''.join([
  swatch('Forest Green', B['forestGreen'], B['warmWhite'], f"Primary brand. Warm White on it {ratio(B['warmWhite'], B['forestGreen']):.2f}:1"),
  swatch('Warm White', B['warmWhite'], B['graphite'], f"Main background. Graphite on it {ratio(B['graphite'], B['warmWhite']):.2f}:1"),
  swatch('Graphite', B['graphite'], B['warmWhite'], f"Text, dark surfaces. Muted Sage on it {ratio(B['mutedSage'], B['graphite']):.2f}:1"),
  swatch('Muted Sage', B['mutedSage'], B['graphite'], f"Decorative on light ({ratio(B['mutedSage'], B['warmWhite']):.2f}:1, never text)"),
  swatch('Soft Green', B['softGreen'], B['forestGreen'], f"Secondary surfaces. Forest on it {ratio(B['forestGreen'], B['softGreen']):.2f}:1"),
])
derived_sw = ''.join([
  swatch('Deep Sage', L['textSecondary'], B['warmWhite'], f"Secondary text on light, {ratio(L['textSecondary'], B['warmWhite']):.2f}:1"),
  swatch('Mid Sage', L['textMuted'], B['warmWhite'], f"Large text, icons, control borders, {ratio(L['textMuted'], B['warmWhite']):.2f}:1"),
  swatch('Light Forest', D['primary'], B['graphite'], f"Dark-theme primary, Graphite label {ratio(B['graphite'], D['primary']):.2f}:1"),
  swatch('Dark Sage', D['textSecondary'], B['graphite'], f"Secondary text on dark, {ratio(D['textSecondary'], B['graphite']):.2f}:1"),
])
light_badges = ''.join(badge(l, r, 'light') for l, r in STATES)
dark_badges = ''.join(badge(l, r, 'dark') for l, r in STATES)

# Art direction: compositions built only from the symbol's own geometry (51.8 degree diagonals, bands, the leaf curve).
K = 0.786  # dx/dy of the symbol's diagonals
def bands(w, h, n, color, gap):
    out = []
    for i in range(n):
        x = -h * K + i * gap
        out.append(f'<path d="M{x:.1f} {h} L{x + h*K:.1f} 0 L{x + h*K + gap*0.55:.1f} 0 L{x + gap*0.55:.1f} {h}Z" fill="{color}"/>')
    return ''.join(out)
comp1 = (f'<svg viewBox="0 0 480 300" class="art"><rect width="480" height="300" fill="{B["forestGreen"]}"/>'
         f'<g opacity="1">{bands(480, 300, 9, "#1E5640", 120)}</g>'
         f'<path d="M60 230 C 160 230, 180 70, 300 70 L 430 70" fill="none" stroke="{B["warmWhite"]}" stroke-width="2"/>'
         f'<path d="M60 230 C 140 230, 200 150, 300 150 L 430 150" fill="none" stroke="{B["mutedSage"]}" stroke-width="2" stroke-dasharray="1 7" stroke-linecap="round"/>'
         f'<circle cx="60" cy="230" r="7" fill="{B["warmWhite"]}"/><circle cx="430" cy="70" r="7" fill="{B["warmWhite"]}"/><circle cx="430" cy="150" r="7" fill="none" stroke="{B["mutedSage"]}" stroke-width="2"/>'
         f'<text x="60" y="262" class="lbl" fill="{B["warmWhite"]}">base</text><text x="430" y="52" class="lbl" fill="{B["warmWhite"]}" text-anchor="end">solana</text>'
         f'<text x="430" y="182" class="lbl" fill="{B["mutedSage"]}" text-anchor="end">refund path</text></svg>')
dots = ''.join(f'<circle cx="{x*12+6}" cy="{y*12+6}" r="{max(0.4, 4.6 - ((x - 18) ** 2 + (y - 12) ** 2) ** 0.5 * 0.22):.2f}" fill="{B["graphite"]}"/>'
               for x in range(40) for y in range(25))
comp2 = (f'<svg viewBox="0 0 480 300" class="art"><rect width="480" height="300" fill="{B["softGreen"]}"/>{dots}'
         f'<image href="{LOGO}spak-symbol.svg" x="300" y="150" width="140" height="123"/></svg>')
steps = [('Intent', 'Swap 50 USDC on Base to SOL'), ('Plan', 'Route validated'), ('Quote', 'Firm quote approved'), ('Deposit', 'Confirmed on Base'), ('Deliver', 'Verified on Solana')]
pw = ''.join(f'<g transform="translate({30 + i*92},0)"><rect x="0" y="118" width="74" height="64" rx="6" fill="{B["warmWhite"]}" stroke="{L["borderStrong"]}"/>'
             f'<text x="37" y="146" text-anchor="middle" class="lbl2" fill="{B["graphite"]}">{a}</text><text x="37" y="166" text-anchor="middle" class="lbl3" fill="{L["textSecondary"]}">{i+1:02d}</text>'
             + (f'<path d="M74 150 H92" stroke="{B["forestGreen"]}" stroke-width="2"/>' if i < 4 else '') + '</g>' for i, (a, _) in enumerate(steps))
comp3 = (f'<svg viewBox="0 0 480 300" class="art"><rect width="480" height="300" fill="{B["warmWhite"]}"/>'
         f'<text x="30" y="60" class="lbl" fill="{L["textSecondary"]}">TRANSACTION PATHWAY</text>{pw}'
         f'<path d="M30 230 H450" stroke="{L["border"]}"/><text x="30" y="258" class="lbl3" fill="{L["textSecondary"]}">Deposit and delivery are verified on chain before a transfer is called complete.</text></svg>')

misuse = [('Stretched', 'transform:scaleX(1.45)'), ('Rotated', 'transform:rotate(-14deg)'), ('Recoloured', 'filter:hue-rotate(150deg) saturate(2)'),
          ('Effects added', 'filter:drop-shadow(0 0 10px #4cff9a) drop-shadow(0 0 22px #4cff9a)'), ('Low contrast', f'background:{B["graphite"]}'), ('Busy background', 'background:repeating-linear-gradient(45deg,#e6007a 0 10px,#00b2ff 10px 20px)')]
misuse_html = ''.join(
    f'<figure class="dont"><div class="dbox" style="{st if st.startswith("background") else ""}"><img src="{LOGO}spak-symbol.svg" style="{st if not st.startswith("background") else ""}" alt=""></div><figcaption>✕ {t}</figcaption></figure>'
    for t, st in misuse)

html = f'''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>SPak Brand Board</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&family=Sora:wght@600&family=Instrument+Serif:ital@1&display=swap" rel="stylesheet">
<style>
:root{{--forest:{B["forestGreen"]};--white:{B["warmWhite"]};--graphite:{B["graphite"]};--sage:{B["mutedSage"]};--soft:{B["softGreen"]};--text2:{L["textSecondary"]};--border:{L["border"]};--bstrong:{L["borderStrong"]}}}
*{{box-sizing:border-box}} body{{margin:0;background:var(--white);color:var(--graphite);font-family:Inter,ui-sans-serif,system-ui,sans-serif;font-size:16px;line-height:1.55}}
.page{{width:1440px;margin:0 auto}} section{{padding:72px 80px;border-top:1px solid var(--border)}}
.k{{font:600 13px/1.3 Inter;letter-spacing:.08em;text-transform:uppercase;color:var(--text2);margin:0 0 20px}}
h2{{font:600 40px/1.12 Sora,Inter,sans-serif;letter-spacing:-.02em;margin:0 0 12px}} .lead{{font-size:19px;color:var(--text2);max-width:38rem;margin:0 0 40px}}
.grid{{display:grid;gap:24px}} .g2{{grid-template-columns:1fr 1fr}} .g3{{grid-template-columns:repeat(3,1fr)}} .g4{{grid-template-columns:repeat(4,1fr)}} .g5{{grid-template-columns:repeat(5,1fr)}} .g6{{grid-template-columns:repeat(6,1fr)}}
.tile{{border-radius:12px;padding:40px;display:flex;align-items:center;justify-content:center;min-height:220px}} .cap{{font-size:13px;color:var(--text2);margin-top:10px}}
.cover{{padding:88px 80px 72px;display:grid;grid-template-columns:1.1fr .9fr;gap:40px;align-items:center;border:0}}
.hero{{font:600 72px/1.05 Sora,sans-serif;letter-spacing:-.03em;margin:28px 0 20px;text-wrap:balance}} .hero em{{font-family:'Instrument Serif',serif;font-weight:400;font-size:1.047em;letter-spacing:-.01em}}
.sw .chip{{height:150px;border-radius:12px;padding:16px;display:flex;flex-direction:column;justify-content:space-between;font-weight:600;border:1px solid rgba(34,39,36,.08)}} .sw code{{font:500 13px JetBrains Mono,monospace}} .sw p{{font-size:13px;color:var(--text2);margin:8px 0 0}}
.badges{{display:flex;flex-wrap:wrap;gap:10px;padding:28px;border-radius:12px}}
.badge{{display:inline-flex;align-items:center;gap:6px;font:600 13px/1.2 Inter;letter-spacing:.01em;padding:6px 10px;border-radius:999px;border:1px solid}}
.spec{{padding:28px;border-radius:12px;background:#fff;border:1px solid var(--border)}} .spec small{{display:block;font:500 12px JetBrains Mono,monospace;color:var(--text2);margin-bottom:10px}}
.tnum{{font-variant-numeric:tabular-nums}} .mono{{font-family:'JetBrains Mono',monospace}}
.row{{display:flex;justify-content:space-between;align-items:baseline;padding:10px 0;border-bottom:1px solid var(--border)}} .row .key{{font:500 13px Inter;color:var(--text2)}} .row:last-child{{border:0}}
.art{{width:100%;border-radius:12px;display:block}} .lbl{{font:500 13px JetBrains Mono,monospace;letter-spacing:.04em}} .lbl2{{font:600 13px Inter}} .lbl3{{font:400 12px JetBrains Mono,monospace}}
.dont{{margin:0}} .dbox{{height:150px;border-radius:12px;background:#fff;border:1px solid var(--border);display:flex;align-items:center;justify-content:center;overflow:hidden}} .dbox img{{height:70px}}
.dont figcaption{{font:600 13px Inter;color:{S["error"]["light"]["foreground"]};margin-top:8px}}
.card{{border-radius:14px;padding:24px;border:1px solid}}
footer{{padding:32px 80px;font-size:13px;color:var(--text2);border-top:1px solid var(--border);display:flex;justify-content:space-between}}
</style></head><body><div class="page">

<header class="cover">
  <div><img src="{LOGO}spak-logo-horizontal.svg" alt="SPak" style="height:72px">
    <p class="hero">Intelligent execution across chains.</p>
    <p class="lead" style="margin:0">Turn intentions into <em style="font-family:'Instrument Serif',serif;font-size:1.05em">verified</em> actions across blockchain networks.</p></div>
  <div class="tile" style="background:var(--forest);min-height:420px"><img src="{LOGO}spak-symbol-white.svg" alt="" style="width:62%"></div>
</header>

<section><p class="k">01 Logo system</p><h2>One symbol, used with discipline.</h2><p class="lead">Approved files only. Symbol and wordmark never redrawn, recoloured outside the palette or rearranged.</p>
  <div class="grid g3">
    <div><div class="tile" style="background:var(--white);border:1px solid var(--border)"><img src="{LOGO}spak-logo-horizontal.svg" alt="" style="width:80%"></div><p class="cap">Primary, light surfaces</p></div>
    <div><div class="tile" style="background:var(--graphite)"><img src="{LOGO}spak-logo-horizontal-dark.svg" alt="" style="width:80%"></div><p class="cap">Dark surfaces: Muted Sage symbol, Warm White wordmark</p></div>
    <div><div class="tile" style="background:var(--forest)"><img src="{LOGO}spak-logo-horizontal-mono-white.svg" alt="" style="width:80%"></div><p class="cap">Mono white on Forest Green</p></div>
  </div>
  <div class="grid g6" style="margin-top:24px">
    <div><div class="tile" style="background:#fff;border:1px solid var(--border);min-height:160px"><img src="{LOGO}spak-symbol.svg" alt="" style="width:60%"></div><p class="cap">Symbol</p></div>
    <div><div class="tile" style="background:#fff;border:1px solid var(--border);min-height:160px"><img src="{LOGO}spak-wordmark.svg" alt="" style="width:80%"></div><p class="cap">Wordmark</p></div>
    <div><div class="tile" style="background:#fff;border:1px solid var(--border);min-height:160px"><img src="{LOGO}spak-logo-stacked.svg" alt="" style="width:55%"></div><p class="cap">Stacked</p></div>
    <div><div class="tile" style="background:#fff;border:1px solid var(--border);min-height:160px"><img src="{LOGO}spak-logo-horizontal-mono-black.svg" alt="" style="width:90%"></div><p class="cap">Mono black</p></div>
    <div><div class="tile" style="background:var(--soft);min-height:160px"><img src="{ICON}spak-app-icon.svg" alt="" style="width:62%"></div><p class="cap">App icon</p></div>
    <div><div class="tile" style="background:#fff;border:1px solid var(--border);min-height:160px;gap:14px"><img src="{ICON}favicon.svg" width="16" alt=""><img src="{ICON}favicon-full.svg" width="32" alt=""><img src="{ICON}favicon-full.svg" width="48" alt=""></div><p class="cap">Favicon 16 / 32 / 48 px</p></div>
  </div>
  <p class="k" style="margin-top:48px">Incorrect use</p>
  <div class="grid g6">{misuse_html}</div>
</section>

<section><p class="k">02 Colour</p><h2>Forest, warm white, graphite.</h2><p class="lead">Every derived colour is computed against WCAG targets. Status always pairs colour with a word and an icon.</p>
  <div class="grid g5">{brand_sw}</div>
  <div class="grid g4" style="margin-top:24px">{derived_sw}</div>
  <div class="grid g2" style="margin-top:32px">
    <div class="badges" style="background:var(--white);border:1px solid var(--border)">{light_badges}</div>
    <div class="badges" style="background:var(--graphite)">{dark_badges}</div>
  </div>
</section>

<section><p class="k">03 Typography</p><h2>Sora speaks. Inter explains. Mono proves.</h2><p class="lead">Four families, each with one job. Numbers are always tabular.</p>
  <div class="grid g2">
    <div class="spec"><small>Sora 600 · display-xl 72/56/40 px</small><div style="font:600 64px/1.05 Sora;letter-spacing:-.03em">Execution, <em style="font-family:'Instrument Serif';font-weight:400;font-size:1.047em">verified.</em></div>
      <small style="margin-top:18px">Inter 400 · lead 20 px</small><p style="font-size:20px;margin:0;color:var(--text2)">Users state what they want. SPak plans it, quotes it, then verifies the deposit and the delivery on chain.</p></div>
    <div class="spec"><small>Inter tabular · approval summary</small>
      <div class="row"><span class="key">You send</span><span class="tnum" style="font:600 18px Inter">1,250.00 <span style="color:var(--text2);font-weight:500">USDC</span></span></div>
      <div class="row"><span class="key">Minimum you receive</span><span class="tnum" style="font:500 16px Inter">7.4183 <span style="color:var(--text2)">SOL</span></span></div>
      <div class="row"><span class="key">Network fee</span><span class="tnum" style="font:400 14px Inter;color:var(--text2)">0.0024 USDC</span></div>
      <div class="row"><span class="key">Recipient</span><span class="mono" style="font-size:13px">9WzDXw…AWWM</span></div>
      <div class="row"><span class="key">Transaction</span><span class="mono" style="font-size:13px">0x1a2b3c…9f8e ⧉</span></div></div>
  </div>
</section>

<section><p class="k">04 Art direction</p><h2>Geometry from the mark, not from a template.</h2><p class="lead">Compositions reuse the symbol's 51.8° diagonals, its bands and its pathways. Halftone gives texture without gradients or glow.</p>
  <div class="grid g3">
    <div>{comp1}<p class="cap">Cross-chain movement: diagonal bands at the symbol angle, one confirmed path and one refund path</p></div>
    <div>{comp2}<p class="cap">Halftone field around the symbol: texture from dots, never from glow</p></div>
    <div>{comp3}<p class="cap">Technical illustration: a transaction pathway, labelled in JetBrains Mono</p></div>
  </div>
</section>

<section><p class="k">05 In product</p><h2>Precision first.</h2><p class="lead">The application is calm and exact: one status, one amount hierarchy, nothing decorative.</p>
  <div class="grid g2">
    <div class="card" style="background:#fff;border-color:var(--border)">
      <div style="display:flex;justify-content:space-between;align-items:center"><span style="font:600 20px Inter">Swap on Base to Solana</span>{badge("Verifying delivery", "processing", "light")}</div>
      <div class="tnum" style="font:600 34px/1.1 Inter;letter-spacing:-.02em;margin:18px 0 4px">50.00 <span style="color:var(--text2);font-weight:500">USDC</span></div>
      <div style="font-size:14px;color:var(--text2)">Deposit confirmed · destination check in progress</div></div>
    <div class="card" style="background:{D["surface"]};border-color:{D["border"]};color:{D["textPrimary"]}">
      <div style="display:flex;justify-content:space-between;align-items:center"><span style="font:600 20px Inter">Swap on Base to Solana</span>{badge("Refunded", "refunded", "dark")}</div>
      <div class="tnum" style="font:600 34px/1.1 Inter;letter-spacing:-.02em;margin:18px 0 4px">49.99 <span style="color:{D["textSecondary"]};font-weight:500">USDC</span></div>
      <div style="font-size:14px;color:{D["textSecondary"]}">Refund verified on Base · returned to 0x71c4…a2e0</div></div>
  </div>
</section>
<footer><span>SPak brand reference board · v1.0 · generated from src/design/colors.json and typography.json</span><span>docs/SPAK-BRAND-GUIDELINES.md</span></footer>
</div></body></html>
'''
open(os.path.join(ROOT, 'public/brand/board/spak-brand-board.html'), 'w').write(html)
print('board written', len(html), 'bytes')
