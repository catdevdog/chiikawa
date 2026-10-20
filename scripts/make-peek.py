#!/usr/bin/env python3
"""
Makes the two pictures a skin hides with, from the skin's own idle pictures (the same frames, so the blinking goes on):

    python3 scripts/make-peek.py            # every skin below
    python3 scripts/make-peek.py usagi      # one skin

  skins/<id>/peek.png  hiding behind a wall: the pet leans out, the face turned away from the wall, two small round hands on its edge
  skins/<id>/hang.png  looking over the top edge of a window: the head down to just under the mouth, two small round hands on the edge

Each is a sheet with a frame for every frame of "idle", and "poses.peek" and "poses.hang" are put in the skin's
manifest.json. Needs Pillow and numpy. The drawing steps are in scripts/peek_art.py, which says what each does.

The numbers below were found by looking at the pictures, so they fit these skins; a new skin needs its own:
  prepare   takes off what would stick out from the face once the picture is turned (the arm on the side of the face
            that leans out), and draws the outline across where it was. The rows and columns are where that arm is.
  peek      face: the middle of the face (the picture is turned about it); tilt: how far, in degrees; wall_dx: how far
            from the middle of the face the wall is (enough for the mouth to be in view); bottom: the row where the body
            in view ends; hands: the middles of the two hands, how far from the wall and which row; hand_r, hand_w:
            the inside of a hand and its outline
  hang      cut: the row of the idle picture just under the mouth; face_x: the middle of the face; hands_dx: how far each
            hand is from it
  The ink is the colour of the outlines, hand the colour of the hands (the colour of the body, unless the hands are
  drawn another colour).

Sprout (skins/default) is drawn as a vector picture by hand, with the wall on the left because its art faces right:
skins/default/peek.svg and skins/default/hang.svg. The wall is the right border of the pictures made here (the art of
the skins below faces left); a skin whose art faces right has its wall on the left: mirror its frames before and after.
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parent))
import peek_art as pa  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent


def load_frames(skin, pose='idle'):
    manifest = json.loads((ROOT / 'skins' / skin / 'manifest.json').read_text(encoding='utf-8'))
    p = manifest['poses'][pose]
    sheet = Image.open(ROOT / 'skins' / skin / p['sheet']).convert('RGBA')
    fw, fh, count = p['frameWidth'], p['frameHeight'], p['count']
    columns = max(1, sheet.width // fw)
    frames = [sheet.crop(((i % columns) * fw, (i // columns) * fh, (i % columns) * fw + fw, (i // columns) * fh + fh)) for i in range(count)]
    durations = p.get('durations', 100)
    return frames, durations if isinstance(durations, list) else [durations] * count


USAGI_INK = (6, 5, 10)
USAGI_BODY = (253, 238, 204)


def usagi_prepare(img):
    # the left arm is a hook that the outline of the body runs into: the outline goes straight across instead
    return pa.bridge(img, rows=(170.0, 192.5), x_span=(30, 92), ink=USAGI_INK, fill=USAGI_BODY, outside='left')


HACHIWARE_INK = (6, 5, 12)
HACHIWARE_BODY = (253, 253, 251)


def hachiware_prepare(img):
    # the left arm (a small paw at x 37-61, y 217-243) is drawn on the body outline, which stops above it and starts again
    # below it; once the picture is turned it hangs out under the head. The outline goes straight across instead. The rows
    # are long on purpose: the head outline above and the body outline below are both clean there, and with these ends
    # the new stroke runs straight (the same slope at both ends, a width of 8 px to 7 px) with no bend.
    return pa.bridge(img, rows=(205.0, 266.0), x_span=(28, 90), ink=HACHIWARE_INK, fill=HACHIWARE_BODY, outside='left')


# Chiikawa. The idle picture holds a lollipop (a swirl in front of the mouth and belly, held with the left arm), and neither
# hiding picture may show it. `chiikawa_prepare` takes it off (swirl, crown, stick and the hand that holds it), puts the plain
# mouth of the skin's "fall" pose where the mouth of the idle face is (the lollipop's crown sits on it), and draws the outline of
# the body straight across where the left arm was. Everything else that sticks out (the other arm, the foot, the tail, the pink
# bag) is behind the wall in the peek and below the cut in the hang.
CHIIKAWA_INK = (1, 1, 1)
CHIIKAWA_BODY = (254, 254, 254)
# The plain mouth, from the fall pose (frame 0, columns 146..175, rows 152..175): the amount of ink of each pixel, 00..ff.
# It is kept here so that no file is needed. Its top left corner goes to (143.75, 148) of the idle frame (the face of the
# fall pose sits 2.25 px to the right and 4 px lower than the idle face).
CHIIKAWA_MOUTH_SIZE = (30, 24)
CHIIKAWA_MOUTH_AT = (143.75, 148.0)
CHIIKAWA_MOUTH = (
    '000000000000000000000000000000000000000000000000000000000000'
    '0000000000000000000000000000051c2914020000000000000000000000'
    '00000000000000000000000000053f91b6852b0100000000000000000000'
    '000000000000000000000000001a8ee8fae87d1200000000000000000000'
    '000000010100000000000000001d9df6fffcb13000000000000000000000'
    '000000000100000000000000011a97f3fffcc74500010000000000000000'
    '00000c2a3a230600010001000854ccfbfffedd5600020100000000000000'
    '000f65b1c3a3510f000000063ec4fafffffdf37a09000000000000000000'
    '0135c1fffcf9cd722819255abbfbfafcfefdfdc85d190b0c121d19040000'
    '0137c6fbeaf3fbdfae9fabd4fcf2fcfffffffef8d1a088838c9f9c631100'
    '00137be1faf5f3f9fcfbfbfaf9fbe9dae8fdfffefdfcf8f0f3f9facb2c00'
    '00001a78ceeefbfaf8f8f9f9f3d5865e7abadae3ebf7fffdfcfceda21f00'
    '000000104c9fd3e8f1f2e9d4a85a170710345b7690bad7dbdcd39b370300'
    '000000000622558ca9a2865b2a09000000010814223a5157574922030000'
    '000000000000051525211607000000000000010000010404040300000000'
    '000000000000010000000000000000000000000000000101010000000000'
    '000000000000000000000000000000000300000000000000000000000000'
    '0000000000000000000000000000052d4f300c0100000000000000000000'
    '000000000000000000000000000136aadbc4792a06000000000000000000'
    '000000000000000000000000010871e6fdf5e6aa3c010000000000000000'
    '000000000000000000000000000554c6f6f9fbce49000000000000000000'
    '0000000000000000000000000000145494b9ba741b000000000000000000'
    '000000000000000000000000000000061b393a1700000000000000000000'
    '000000000000000000000000000000000000000000000000000000000000'
)


def chiikawa_prepare(img):
    ss = pa.SS
    f = img.copy()
    # the lollipop and the hand that holds it: the plain body is white (the box is x 129..185, y 148..208 of the frame; the
    # eyes end at row 147, the cheeks are outside it)
    f.paste(CHIIKAWA_BODY + (255,), (129 * ss, 148 * ss, 185 * ss, 208 * ss))
    # the plain mouth
    w, h = CHIIKAWA_MOUTH_SIZE
    alpha = Image.frombytes('L', (w, h), bytes.fromhex(CHIIKAWA_MOUTH)).resize((w * ss, h * ss), Image.LANCZOS)
    ink = Image.new('RGBA', alpha.size, CHIIKAWA_INK + (255,))
    ink.putalpha(alpha)
    f.alpha_composite(ink, (round(CHIIKAWA_MOUTH_AT[0] * ss), round(CHIIKAWA_MOUTH_AT[1] * ss)))
    # the left arm: the outline of the head runs straight on into the outline of the body (rows 178..218) instead
    return pa.bridge(f, rows=(178, 218), x_span=(60, 135), ink=CHIIKAWA_INK, fill=CHIIKAWA_BODY, outside='left', window=6)


RAKKO_INK = (34, 19, 17)
RAKKO_HAND = (52, 34, 31)     # the hands in the art are as dark as the outline; a little lighter here so the ring reads
RAKKO_BODY = (252, 242, 219)

# Low on the left side of Rakko's body: the scarf is a white band across the body, and at its left end hang a loose end of
# the scarf (a flap) and a dark hand. Once the picture is turned they stick out of the body below the face. They are taken
# off, and the scarf band with them (what would still show of it is its round end beside the hands, and that reads as
# a loose end again). The body outline here is only the plain edge of the cream, so it is drawn straight on from the head's
# edge (clean down to row 178) to the body's edge, and the body is filled to it.
# RAKKO_EDGE: (x, y) of that new left edge of the body, in pixels of the frame.
RAKKO_EDGE = [
    (41.5, 178.0), (43.0, 180.0), (44.5, 182.0), (46.0, 184.0), (48.2, 188.0), (50.3, 192.0), (52.2, 196.0), (54.0, 200.0),
    (55.4, 204.0), (56.6, 208.0), (57.5, 212.0), (58.2, 217.0), (58.9, 223.0), (60.0, 231.0), (61.5, 241.0), (63.0, 250.0),
    (66.0, 257.0), (71.0, 263.0), (80.0, 271.0), (86.0, 277.0),
]
RAKKO_FILL_RIGHT = 140.0     # to the right of this column, and below the last row, the picture is left as it is (behind the wall)
RAKKO_FILL_TOP = 177.0
RAKKO_FILL_BOTTOM = 277.0


def rakko_prepare(img):
    """`img` is a frame made SS times as big. Takes off the scarf, its loose end and the left hand (all rows alike)."""
    ss = pa.SS
    arr = np.asarray(img).copy()
    h, w = arr.shape[:2]
    curve = [(x * ss, y * ss) for x, y in RAKKO_EDGE]
    # left of the new edge: nothing
    gone = Image.new('L', (w, h), 0)
    ImageDraw.Draw(gone).polygon([(0, RAKKO_EDGE[0][1] * ss)] + curve + [(0, RAKKO_FILL_BOTTOM * ss)], fill=255)
    arr[np.asarray(gone) > 0] = 0
    # right of it: plain body, over the scarf band, the hand and the top of the flap
    paint = Image.new('L', (w, h), 0)
    corner = (RAKKO_EDGE[0][0] + 3.5) * ss
    ImageDraw.Draw(paint).polygon(
        [(corner, RAKKO_FILL_TOP * ss), (RAKKO_FILL_RIGHT * ss, RAKKO_FILL_TOP * ss), (RAKKO_FILL_RIGHT * ss, RAKKO_FILL_BOTTOM * ss),
         (curve[-1][0], RAKKO_FILL_BOTTOM * ss)] + curve[::-1], fill=255)
    m = np.asarray(paint) > 0
    arr[m, :3] = np.array(RAKKO_BODY, dtype=np.uint8)
    arr[m, 3] = 254
    return Image.fromarray(arr, 'RGBA')


SKINS = {
    'usagi': dict(
        ink=USAGI_INK,
        hand=USAGI_BODY,
        prepare=usagi_prepare,
        peek=dict(face=(112, 128), tilt=60, wall_dx=23, bottom=204, hands=[(2, 176), (2, 206)], hand_r=10, hand_w=4),
        hang=dict(cut=166, face_x=118, hands_dx=62, hand_r=10, hand_w=4),
    ),
    'hachiware': dict(
        ink=HACHIWARE_INK,
        hand=HACHIWARE_BODY,
        prepare=hachiware_prepare,
        # face: the middle of the eyes (at (114, 162) and (186, 168)); wall_dx: the rightmost pixel of the mouth (the little
        # dash under it included) is 40.8 to the right of the face, and the wall is 2 more; bottom: the row where the lower outline
        # of the head meets the wall, the lower hand is 2 px under it and the upper hand 2 * (r + w) + 2 above that
        peek=dict(face=(150, 165), tilt=60, wall_dx=43, bottom=277, hands=[(2, 231), (2, 279)], hand_r=17, hand_w=6),
        # cut: 16 px under the last row of the mouth (212); hands_dx: the head is 207 px wide at the cut (from x 47 to 254)
        hang=dict(cut=229, face_x=150, hands_dx=86, hand_r=17, hand_w=6),
    ),
    'chiikawa': dict(
        ink=CHIIKAWA_INK,
        hand=CHIIKAWA_BODY,
        prepare=chiikawa_prepare,
        peek=dict(face=(157, 137), tilt=60, wall_dx=34, bottom=210, hands=[(2, 176), (2, 210)], hand_r=11.5, hand_w=4.5),
        hang=dict(cut=182, face_x=160.5, hands_dx=61.5, hand_r=11.5, hand_w=4.5),
    ),
    'rakko': dict(
        ink=RAKKO_INK,
        hand=RAKKO_HAND,
        prepare=rakko_prepare,
        # face: the point the picture turns about. The middle of the eyes is (154, 131); it is moved 10 px to the right, so that the
        # right ear is not clipped by the top of the frame while the picture turns (the picture is the same, only 8.7 px lower in
        # the frame); wall_dx: the rightmost pixel of the mouth (the little curve under it included) turns to 32.9 to the right of
        # the middle of the eyes and the wall is 2 more, that is 35, and 30 for the moved face; bottom: the row where the lower
        # edge of the head meets the wall, the lower hand is 2 px under it and the upper hand 2 * (r + w) + 2 above that;
        # the outside of a hand, 2 * (r + w) = 48, is 0.19 of the head's width (250)
        peek=dict(face=(164, 131), tilt=60, wall_dx=30, bottom=272, hands=[(2, 224), (2, 274)], hand_r=18, hand_w=6),
        # cut: 12 px under the last row of the mouth (167), just above the top of the scarf (178); face_x: the middle of the head
        # at the cut (from x 43 to 269; the middle of the eyes is 2 px to the left of it); hands_dx: 0.85 of half of that width
        hang=dict(cut=179, face_x=156, hands_dx=96, hand_r=18, hand_w=6),
    ),
}


def make(skin, cfg):
    frames, durations = load_frames(skin)
    W, H = frames[0].size
    path = ROOT / 'skins' / skin / 'manifest.json'
    manifest = json.loads(path.read_text(encoding='utf-8'))
    feet = round(manifest['anchor']['y'] * H)
    bigs = [pa.big(f) for f in frames]
    if cfg.get('prepare'):
        bigs = [cfg['prepare'](b) for b in bigs]
    ink, hand = cfg['ink'], cfg['hand']
    pictures = {
        'peek': pa.peek_frames(bigs, (W, H), hand_fill=hand, ink=ink, **cfg['peek']),
        'hang': pa.hang_frames(bigs, (W, H), feet=feet, hand_fill=hand, ink=ink, **cfg['hang']),
    }
    for pose, result in pictures.items():
        top, bottom, left = pa.extent(result)
        # something touching the border of the picture (other than the wall) is cut off by it
        if top < 2 or bottom > H - 2 or (pose == 'peek' and left < 2):
            print(f'  warning: the {pose} picture of {skin} reaches the border (top {top}, bottom {bottom}, left {left})')
        pa.sheet_of(result).save(ROOT / 'skins' / skin / f'{pose}.png', optimize=True)
        manifest['poses'][pose] = dict(sheet=f'{pose}.png', frameWidth=W, frameHeight=H, count=len(result), durations=durations)
    path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'{skin}: {len(frames)} frames of {W}x{H}')


if __name__ == '__main__':
    for name in sys.argv[1:] or list(SKINS):
        make(name, SKINS[name])
