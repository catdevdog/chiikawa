#!/usr/bin/env python3
"""
Makes the picture a skin hides with ("peek"): the head of the character, tilted towards the wall and cut by it, with
two hands holding the edge. It is made from the skin's own idle pictures (the same frames, so the blinking goes on),
which is how the pictures of the bundled skins were made:

    python3 scripts/make-peek.py            # every skin below
    python3 scripts/make-peek.py usagi      # one skin

It writes skins/<id>/peek.png (a sheet with a frame for every frame of "idle") and puts "poses.peek" in the skin's
manifest.json. Needs Pillow. The numbers below were found by looking at the pictures, so they fit these skins; a
new skin needs its own: the ellipse that holds the head (centre x, centre y, radius x, radius y, in pixels of one
frame), the colours of the outline and of the hands, how much the head tilts and how much of it stays in view.

Sprout (skins/default/peek.svg) is drawn by hand, as a vector picture, with the wall on the left because its
art faces right. The wall is the right border of the picture here (the art of the skins below faces left). A skin whose art faces right has its
wall on the left: draw it, or mirror the frames before and after.
"""
import json
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SS = 4  # everything that is drawn or rotated is done at this many times the size, and then made small again


def load_frames(skin, pose='idle'):
    manifest = json.loads((ROOT / 'skins' / skin / 'manifest.json').read_text(encoding='utf-8'))
    p = manifest['poses'][pose]
    sheet = Image.open(ROOT / 'skins' / skin / p['sheet']).convert('RGBA')
    fw, fh, count = p['frameWidth'], p['frameHeight'], p['count']
    columns = max(1, sheet.width // fw)
    frames = [sheet.crop(((i % columns) * fw, (i // columns) * fh, (i % columns) * fw + fw, (i // columns) * fh + fh)) for i in range(count)]
    durations = p.get('durations', 100)
    return frames, durations if isinstance(durations, list) else [durations] * count


def big(im):
    return im.resize((im.width * SS, im.height * SS), Image.LANCZOS)


def head_only(frame, ellipse, outline, width):
    """What is above the middle of the ellipse and inside it; the chin is drawn where the body was."""
    cx, cy, rx, ry = ellipse
    f = big(frame)
    w, h = f.size
    keep = Image.new('L', (w, h), 0)
    d = ImageDraw.Draw(keep)
    d.rectangle([0, 0, w, int(cy * SS)], fill=255)
    d.ellipse([(cx - rx) * SS, (cy - ry) * SS, (cx + rx) * SS, (cy + ry) * SS], fill=255)
    alpha = ImageChops.multiply(f.getchannel('A'), keep)
    # a line along the lower edge of the ellipse, but only where there was body to draw it on
    stroke = Image.new('L', (w, h), 0)
    ImageDraw.Draw(stroke).arc([(cx - rx) * SS, (cy - ry) * SS, (cx + rx) * SS, (cy + ry) * SS], 0, 180, fill=255, width=int(width * SS))
    stroke = ImageChops.multiply(stroke, f.getchannel('A').filter(ImageFilter.MaxFilter(int(width * SS) | 1)))
    out = f.copy()
    out.putalpha(alpha)
    ink = Image.new('RGBA', (w, h), outline + (255,))
    ink.putalpha(stroke)
    return Image.alpha_composite(out, ink)


def hand(finger, reach, fill, outline, width, crease):
    """Three fingertips curled over the edge, drawn so that the wall (the right border of the picture) cuts them in the middle."""
    r = finger
    pad = 6 * SS
    gap = r * 1.5
    h = int((gap * 2 + r * 2) * SS)
    w = int(reach * SS)
    im = Image.new('RGBA', (w + 2 * pad, h + 2 * pad), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    iw = int(width * SS)
    cy0 = pad + h / 2
    right = pad + w
    ys = [cy0 + k * gap * SS for k in (-1, 0, 1)]
    # the outline first and the fill on top of it: where two fingers touch they become one
    for y in ys:
        d.ellipse([right - reach * SS - iw, y - r * SS - iw, right + reach * SS * 0.2 + iw, y + r * SS + iw], fill=outline + (255,))
    for y in ys:
        d.ellipse([right - reach * SS, y - r * SS, right + reach * SS * 0.2, y + r * SS], fill=fill + (255,))
    for k in (-0.5, 0.5):
        y = cy0 + k * gap * SS
        d.line([(right - reach * SS * 0.95, y), (right - reach * SS * 0.5, y)], fill=(crease or outline) + (255,), width=max(2, int(width * SS * 0.6)))
    return im


def chiikawa_without_lollipop(frame):
    """Takes the lollipop out of the mouth: the plain face of the fall pose lends its mouth."""
    plain = load_frames('chiikawa', 'fall')[0][0]
    f = frame.copy()
    ImageDraw.Draw(f).rectangle([128, 150, 186, 206], fill=(255, 255, 255, 255))
    f.alpha_composite(plain.crop((144, 150, 184, 178)), (144, 150 + 16))
    return f


TWO_HANDS = [dict(y=0.22), dict(y=0.84)]

SKINS = {
    'usagi': dict(ellipse=(118, 142, 80, 52), outline=(6, 5, 10), fill=(253, 238, 204), width=5, tilt=16, shown=0.78, finger=9, reach=20),
    'chiikawa': dict(ellipse=(160, 125, 92, 66), outline=(1, 1, 1), fill=(254, 254, 254), width=5, tilt=16, shown=0.78, finger=9, reach=20, prepare=chiikawa_without_lollipop),
    'hachiware': dict(ellipse=(153, 168, 118, 70), outline=(6, 5, 12), fill=(253, 253, 251), width=6, tilt=16, shown=0.78, finger=10, reach=22),
    # Rakko's hands are dark in the pictures
    'rakko': dict(ellipse=(160, 150, 150, 70), outline=(34, 19, 17), fill=(250, 241, 219), width=5, tilt=14, shown=0.78, finger=10, reach=22,
                  hands=dict(fill=(52, 34, 31), outline=(34, 19, 17), crease=(120, 96, 90))),
}


def make(skin, cfg):
    frames, durations = load_frames(skin)
    if cfg.get('prepare'):
        frames = [cfg['prepare'](f) for f in frames]
    W, H = frames[0].size
    feet_line = frames[0].getchannel('A').point(lambda a: 255 if a > 40 else 0).getbbox()[3]
    hands = cfg.get('hands', {})
    placed = None
    result = []
    for frame in frames:
        head = head_only(frame, cfg['ellipse'], cfg['outline'], cfg['width'])
        cx, cy = cfg['ellipse'][0], cfg['ellipse'][1] - cfg['ellipse'][3] * 0.3
        head = head.rotate(-cfg['tilt'], resample=Image.BICUBIC, center=(cx * SS, cy * SS))
        if placed is None:
            # the first frame decides where the head goes, the same for all of them (nothing jumps when ears move)
            x0, y0, x1, y1 = [v / SS for v in head.getchannel('A').point(lambda a: 255 if a > 40 else 0).getbbox()]
            placed = (W - (x0 + cfg['shown'] * (x1 - x0)), feet_line - y1, y0, y1)
        dx, dy, y0, y1 = placed
        canvas = Image.new('RGBA', (W * SS, H * SS), (0, 0, 0, 0))
        canvas.alpha_composite(head, (int(dx * SS), int(dy * SS)))
        for spot in TWO_HANDS:
            im = hand(cfg['finger'], cfg['reach'], hands.get('fill', cfg['fill']), hands.get('outline', cfg['outline']), cfg['width'], hands.get('crease'))
            canvas.alpha_composite(im, (int(W * SS - im.width + 6 * SS), int((y0 + dy + spot['y'] * (y1 - y0)) * SS - im.height / 2)))
        # nothing beyond the wall
        wall = Image.new('L', canvas.size, 0)
        ImageDraw.Draw(wall).rectangle([0, 0, W * SS, H * SS], fill=255)
        canvas.putalpha(ImageChops.multiply(canvas.getchannel('A'), wall))
        result.append(canvas.resize((W, H), Image.LANCZOS))
    sheet = Image.new('RGBA', (W * len(result), H), (0, 0, 0, 0))
    for i, f in enumerate(result):
        sheet.paste(f, (i * W, 0))
    sheet.save(ROOT / 'skins' / skin / 'peek.png', optimize=True)
    path = ROOT / 'skins' / skin / 'manifest.json'
    manifest = json.loads(path.read_text(encoding='utf-8'))
    manifest['poses']['peek'] = dict(sheet='peek.png', frameWidth=W, frameHeight=H, count=len(result), durations=durations)
    path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'{skin}: {len(result)} frames of {W}x{H}')


if __name__ == '__main__':
    for name in sys.argv[1:] or list(SKINS):
        make(name, SKINS[name])
