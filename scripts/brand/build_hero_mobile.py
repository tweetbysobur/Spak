"""
Portrait (2:3) hero background for phones, built only from the approved landscape
(public/brand/images/spak-hero-landscape.png). Nothing is generated, stretched or recoloured:

1. The valley at the landscape's own scale: the left hillside and mist at the bottom left, the rock face and right
   slope rising along the right edge.
2. Sky: the landscape's own dark, near-empty sky (left of the rock face, above the mist), scaled uniformly and
   placed above, so the headline and paragraph sit on dark open space.
3. Top-right cloud: the landscape's own cloud bank, placed in the top-right corner.
The pieces meet through soft masks across dark sky, so no seam shows.

Run: python3 scripts/brand/build_hero_mobile.py   (then python3 scripts/brand/build_inventory.py)
"""
import os
from PIL import Image, ImageFilter, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = os.path.join(ROOT, 'public/brand/images/spak-hero-landscape.png')
OUT = os.path.join(ROOT, 'public/brand/images/spak-hero-landscape-mobile.jpg')
W, H = 1080, 1620

def scaled(box, width):
    """Crop box from the source and scale it uniformly to the given width."""
    piece = src.crop(box)
    return piece.resize((width, round(piece.height * width / piece.width)), Image.LANCZOS)

def feather(size, top=0, bottom=0, left=0, right=0):
    """Opaque mask that fades to transparent over the given number of pixels at each edge."""
    w, h = size
    m = Image.new('L', size, 255); d = ImageDraw.Draw(m)
    for i in range(top): d.line([(0, i), (w, i)], fill=round(255 * (i / top) ** 1.5))
    for i in range(bottom): d.line([(0, h - 1 - i), (w, h - 1 - i)], fill=min(m.getpixel((0, h - 1 - i)), round(255 * (i / bottom) ** 1.5)))
    if left or right:
        cols = Image.new('L', size, 255); dc = ImageDraw.Draw(cols)
        for i in range(left): dc.line([(i, 0), (i, h)], fill=round(255 * (i / left) ** 1.5))
        for i in range(right): dc.line([(w - 1 - i, 0), (w - 1 - i, h)], fill=round(255 * (i / right) ** 1.5))
        m = Image.composite(m, Image.new('L', size, 0), cols)
    return m

src = Image.open(SRC).convert('RGB')

# Base: the median colour of the landscape's open sky, so every soft edge blends into the image's own sky.
sky_px = sorted(src.crop((300, 120, 1000, 380)).get_flattened_data(), key=sum)
canvas = Image.new('RGB', (W, H), sky_px[len(sky_px) // 2])

# 2. Sky: dark open sky from the landscape, above the mist and left of the rock face.
sky = scaled((250, 0, 1050, 400), W)                                  # 800 x 400 -> 1080 x 540
canvas.paste(sky, (0, 0), feather(sky.size, bottom=260))
sky2 = scaled((300, 60, 1000, 400), W).transpose(Image.FLIP_TOP_BOTTOM)  # 700 x 340 -> 1080 x 525, mirrored
canvas.paste(sky2, (0, 470), feather(sky2.size, top=240, bottom=240))

# 3. Cloud bank from the top right of the landscape, in the top-right corner.
cloud = scaled((1180, 0, 1774, 260), 640)                             # 594 x 260 -> 640 x 280
canvas.paste(cloud, (W - cloud.width, 0), feather(cloud.size, bottom=160, left=280))

# 1. The valley, at the landscape's own scale (no resizing): the left hillside with the mist, bottom left; the rock
#    face with the right slope, rising along the right edge. Together they frame the text as the landscape does
#    on desktop, with mist between them.
left = src.crop((0, 360, 760, 887))                                   # 760 x 527
canvas.paste(left, (0, H - left.height), feather(left.size, top=220, right=260))
right = src.crop((950, 180, 1774, 887))                               # 824 x 707
canvas.paste(right, (W - right.width, H - right.height), feather(right.size, top=240, left=280))

canvas.save(OUT, 'JPEG', quality=90, optimize=True, progressive=True)
print('saved', os.path.relpath(OUT, ROOT), canvas.size, round(os.path.getsize(OUT) / 1024), 'KB')
