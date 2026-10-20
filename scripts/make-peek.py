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

from PIL import Image

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


SKINS = {
    'usagi': dict(
        ink=USAGI_INK,
        hand=USAGI_BODY,
        prepare=usagi_prepare,
        peek=dict(face=(112, 128), tilt=60, wall_dx=23, bottom=204, hands=[(2, 176), (2, 206)], hand_r=10, hand_w=4),
        hang=dict(cut=166, face_x=118, hands_dx=62, hand_r=10, hand_w=4),
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
