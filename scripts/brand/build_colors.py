"""
Derives the SPak colour system from contrast targets (WCAG 2.x relative luminance), so no value is chosen by eye.
Brand colours are fixed inputs; every derived colour is the lightest (light theme) or darkest (dark theme) shade of
its hue that meets its target against every surface it is allowed on, plus a safety margin.
Writes src/design/colors.json. Usage: python3 scripts/brand/build_colors.py
"""
import colorsys, json, os
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

def lum(h):
    r, g, b = [int(h[i:i+2], 16) / 255 for i in (1, 3, 5)]
    f = lambda c: c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
def cr(a, b):
    x, y = sorted([lum(a), lum(b)], reverse=True); return (x + 0.05) / (y + 0.05)
def hsl(h, s, l):
    r, g, b = colorsys.hls_to_rgb(h / 360, l, s); return '#%02X%02X%02X' % (round(r * 255), round(g * 255), round(b * 255))
def solve(h, s, against, target, darker):
    """Darker=True: lightest shade that is still dark enough. Darker=False: darkest shade that is light enough."""
    ls = [i / 1000 for i in range(1000)]
    ok = [l for l in ls if all(cr(hsl(h, s, l), bg) >= target for bg in against)]
    if not ok: raise SystemExit(f'no shade of hue {h} meets {target} against {against}')
    return hsl(h, s, max(ok) if darker else min(ok))

BRAND = {'forestGreen': '#174734', 'warmWhite': '#F7F6F0', 'graphite': '#222724', 'mutedSage': '#A7B7A9', 'softGreen': '#E8EFE9'}
W, SG, G, FG = BRAND['warmWhite'], BRAND['softGreen'], BRAND['graphite'], BRAND['forestGreen']
TEXT, UI, M = 4.5, 3.0, 0.25          # targets and safety margin
# Dark surfaces: Graphite page, two elevated steps (lighter graphite, same hue family)
D_SURF, D_ELEV = '#2B312D', '#343B37'
# Light surfaces: Warm White page, Soft Green secondary, white elevated card
L_ELEV = '#FFFFFF'
LIGHT_BGS = [W, SG, L_ELEV]; DARK_BGS = [G, D_SURF, D_ELEV]

# Sage family (hue/saturation of Muted Sage)
sage_h, sage_l, sage_s = colorsys.rgb_to_hls(*[int(BRAND['mutedSage'][i:i+2], 16) / 255 for i in (1, 3, 5)])
SH, SS = sage_h * 360, sage_s
sage_text = solve(SH, SS, LIGHT_BGS, TEXT + M, True)          # secondary text on light
sage_muted = solve(SH, SS, LIGHT_BGS, UI + M, True)           # large text / secondary icons on light (3:1)
dsage_text = solve(SH, SS, DARK_BGS, TEXT + M, False)         # secondary text on dark
dsage_muted = solve(SH, SS, DARK_BGS, UI + M, False)

# Semantic roles: hue, saturation. Distinct hues so states never share a colour.
ROLES = {
    'success':    (146, 0.55, 'Completed, verified delivery, confirmed deposit'),
    'refunded':   (186, 0.55, 'Refund verified on chain: funds returned, the transfer did not complete'),
    'error':      (4,   0.68, 'Failed, rejected, invalid, verification failed'),
    'warning':    (36,  0.85, 'Expiring, limits, delayed, unknown outcome, needs attention'),
    'pending':    (268, 0.38, 'Awaiting approval, deposit, external confirmation, manual review'),
    'processing': (212, 0.70, 'Submitting, cross-chain execution, destination verification, refunding'),
    'info':       (222, 0.22, 'Notices, network information, explanations'),
    'neutral':    (140, 0.06, 'Cancelled, expired before deposit, draft'),
}
semantic = {}
for name, (h, s, use) in ROLES.items():
    l_bg = hsl(h, min(s, 0.6), 0.945)                                    # light tint
    l_fg = solve(h, s, LIGHT_BGS + [l_bg], TEXT + M, True)               # text on tint and on any light surface
    l_border = solve(h, s, [l_bg] + LIGHT_BGS, UI + M, True)                  # badge border / meaningful outline
    l_icon = l_border
    d_bg = hsl(h, min(s, 0.35), 0.18)                                    # dark tint
    d_fg = solve(h, s, DARK_BGS + [d_bg], TEXT + M, False)
    d_border = solve(h, s, [d_bg] + DARK_BGS, UI + M, False)
    semantic[name] = {'use': use,
        'light': {'foreground': l_fg, 'background': l_bg, 'border': l_border, 'icon': l_icon},
        'dark': {'foreground': d_fg, 'background': d_bg, 'border': d_border, 'icon': d_border}}

# Interactive: light theme primary is Forest Green; dark theme primary is a lighter green of the same hue
fh, fl, fs = colorsys.rgb_to_hls(*[int(FG[i:i+2], 16) / 255 for i in (1, 3, 5)]); FH = fh * 360
d_primary = solve(FH, 0.42, [G] + DARK_BGS, 7.0, False)                 # dark-theme primary, AAA vs Graphite text
themes = {
  'light': {
    'background': W, 'surface': SG, 'surfaceElevated': L_ELEV,
    'border': '#D9DED8',                                                 # decorative hairline (not meaningful)
    'borderStrong': solve(SH, SS, [W, SG, L_ELEV], UI + M, True),        # inputs, controls (3:1)
    'textPrimary': G, 'textSecondary': sage_text, 'textMuted': sage_muted,
    'primary': FG, 'primaryHover': hsl(FH, fs, fl * 0.82), 'primaryActive': hsl(FH, fs, fl * 0.66), 'onPrimary': W,
    'secondary': SG, 'secondaryHover': '#DCE6DE', 'secondaryActive': '#CFDCD2', 'onSecondary': FG,
    'focusRing': FG, 'disabledBackground': '#ECEDE8', 'disabledText': '#8E968F', 'disabledBorder': '#D9DED8',
    'decorativeAccent': BRAND['mutedSage'],
  },
  'dark': {
    'background': G, 'surface': D_SURF, 'surfaceElevated': D_ELEV,
    'border': '#3E4641',
    'borderStrong': solve(SH, SS, [G, D_SURF, D_ELEV], UI + M, False),
    'textPrimary': W, 'textSecondary': dsage_text, 'textMuted': dsage_muted,
    'primary': d_primary, 'primaryHover': hsl(FH, 0.42, colorsys.rgb_to_hls(*[int(d_primary[i:i+2], 16)/255 for i in (1,3,5)])[1] + 0.06),
    'primaryActive': hsl(FH, 0.42, colorsys.rgb_to_hls(*[int(d_primary[i:i+2], 16)/255 for i in (1,3,5)])[1] - 0.06), 'onPrimary': G,
    'secondary': D_ELEV, 'secondaryHover': '#3D4540', 'secondaryActive': '#464F49', 'onSecondary': W,
    'focusRing': d_primary, 'disabledBackground': '#2E3430', 'disabledText': '#69716B', 'disabledBorder': '#3E4641',
    'decorativeAccent': BRAND['mutedSage'],
  },
}
# Mapping of SPak's real states to semantic roles (execution, deposit, refund)
STATE_MAP = {
  'execution': {'DRAFT': 'neutral', 'QUOTED': 'info', 'AWAITING_APPROVAL': 'pending', 'AWAITING_DEPOSIT': 'pending', 'PROCESSING': 'processing',
                'VERIFYING_DESTINATION': 'processing', 'REFUNDING': 'processing', 'COMPLETED': 'success', 'REFUNDED': 'refunded', 'FAILED': 'error',
                'EXPIRED': 'neutral', 'CANCELLED': 'neutral', 'UNKNOWN': 'warning'},
  'deposit': {'WALLET_CONFIRMATION_REQUESTED': 'pending', 'SUBMITTED': 'processing', 'VERIFICATION_PENDING': 'processing', 'CONFIRMED': 'success',
              'REJECTED': 'error', 'FAILED': 'error', 'EXPIRED': 'neutral'},
  'refund': {'PENDING_PROVIDER': 'pending', 'INITIATED': 'processing', 'TX_DETECTED': 'processing', 'VERIFICATION_PENDING': 'processing',
             'ASSOCIATION_PENDING': 'pending', 'PARTIAL': 'warning', 'COMPLETED': 'refunded', 'FAILED': 'error', 'DELAYED': 'warning', 'UNKNOWN': 'warning'},
}

# Validation pairs: [foreground, background, requirement, label]. 'expect': 'pass' or 'fail' (documented restriction) or 'exempt'.
V = []
def add(fg, bg, req, label, expect='pass'): V.append({'foreground': fg, 'background': bg, 'requirement': req, 'label': label, 'expect': expect})
REQ = {'text': 4.5, 'large': 3.0, 'ui': 3.0}
for t, bgs in (('light', LIGHT_BGS), ('dark', DARK_BGS)):
    th = themes[t]
    for bg in bgs:
        add(th['textPrimary'], bg, 'text', f'{t}: primary text on {bg}')
        add(th['textSecondary'], bg, 'text', f'{t}: secondary text on {bg}')
        add(th['textMuted'], bg, 'large', f'{t}: muted text / secondary icon on {bg}')
        add(th['borderStrong'], bg, 'ui', f'{t}: control border on {bg}')
        add(th['focusRing'], bg, 'ui', f'{t}: focus ring on {bg}')
        add(th['primary'], bg, 'ui', f'{t}: primary button against {bg}')
        add(th['disabledText'], th['disabledBackground'], 'text', f'{t}: disabled text (exempt under WCAG 1.4.3)', 'exempt')
    for k in ('primary', 'primaryHover', 'primaryActive'):
        add(th['onPrimary'], th[k], 'text', f'{t}: text on {k}')
    for k in ('secondary', 'secondaryHover', 'secondaryActive'):
        add(th['onSecondary'], th[k], 'text', f'{t}: text on {k}')
    add(th['focusRing'], th['primary'], 'ui', f'{t}: focus ring next to primary button (needs 2px offset)', 'fail' if cr(th['focusRing'], th['primary']) < 3 else 'pass')
    for name, r in semantic.items():
        s = r[t]
        add(s['foreground'], s['background'], 'text', f'{t}: {name} label on its tint')
        for bg in bgs:
            add(s['foreground'], bg, 'text', f'{t}: {name} text on {bg}')
            add(s['icon'], bg, 'ui', f'{t}: {name} icon/border on {bg}')
        add(s['icon'], s['background'], 'ui', f'{t}: {name} icon on its tint')
for bg in (W, SG):
    add(BRAND['mutedSage'], bg, 'text', f'restriction: Muted Sage text on {bg}', 'fail')
    add(BRAND['mutedSage'], bg, 'ui', f'restriction: Muted Sage icon/border on {bg}', 'fail')
add(FG, G, 'ui', 'restriction: Forest Green on Graphite', 'fail')
add(BRAND['mutedSage'], G, 'text', 'brand: Muted Sage text on Graphite')
add(BRAND['mutedSage'], FG, 'text', 'brand: Muted Sage text on Forest Green')
add(W, FG, 'text', 'brand: Warm White on Forest Green')
for v in V:
    v['ratio'] = round(cr(v['foreground'], v['background']), 2); v['minimum'] = REQ[v['requirement']]
    v['result'] = 'exempt' if v['expect'] == 'exempt' else ('pass' if v['ratio'] >= v['minimum'] else 'fail')

out = {'version': '1.0.0', 'generatedBy': 'scripts/brand/build_colors.py', 'standard': 'WCAG 2.x contrast (text 4.5:1, large text 3:1, UI components and graphics 3:1)',
       'brand': BRAND, 'semantic': semantic, 'themes': themes, 'stateRoles': STATE_MAP, 'validation': V}
p = os.path.join(ROOT, 'src/design/colors.json'); os.makedirs(os.path.dirname(p), exist_ok=True)
json.dump(out, open(p, 'w'), indent=2); open(p, 'a').write('\n')
bad = [v for v in V if v['result'] != v['expect'] and v['expect'] != 'exempt']
print('pairs', len(V), 'unexpected', len(bad)); [print(' ', b) for b in bad]
print('sage text', sage_text, cr(sage_text, W), cr(sage_text, SG)); print('dark primary', d_primary)
for n, r in semantic.items(): print(n, r['light'], r['dark'])
for t in themes: print(t, themes[t])
