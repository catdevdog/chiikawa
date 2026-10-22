"""
The drawing steps behind the pictures a skin hides with (scripts/make-peek.py uses them; read that file first).

Two pictures are made from a skin's own "idle" frames (the same frames, so the blinking goes on):

  peek  the pet leans out from behind a wall that stands at the right border of the picture. The whole picture is
        turned counter-clockwise about the middle of the face, so that the face tilts away from the wall and the
        body goes behind it by itself; the wall cuts the picture there. Two small round hands ("O") hold the edge, one
        on each side of the face: where the outline of the head comes to the wall at the top, and at the bottom.
  hang  the pet looks over the top edge of a window: the head from the ears down to just under the mouth, cut flat
        along the bottom of the picture (the edge), with two small round hands on that edge, one on each side.

Everything that is drawn or turned is done SS times as big, and made small again after.
"""
import math

import numpy as np
from PIL import Image, ImageDraw

SS = 4


def big(im):
    return im.resize((im.width * SS, im.height * SS), Image.LANCZOS)


# --- taking a stray part off (an arm that sticks out of the outline) ---------------------------------------------------


def _coverage(arr, row, ink, paper):
    """How much of each pixel of a row is ink (0..1): by how transparent it is, or by how dark it has got on the paper."""
    px = arr[row].astype(np.float64)
    lum = px[:, :3].mean(axis=1)
    lc, ld = float(np.mean(paper)), float(np.mean(ink))
    return (px[:, 3] / 255.0) * np.clip((lc - lum) / (lc - ld), 0, 1)


def _stroke_row(arr, row, x0, x1, ink, paper, window):
    """(centre in big pixels, cross-section around the centre, ink in big pixels) of the stroke that runs through a row."""
    c = _coverage(arr, row, ink, paper)[x0:x1]
    xs = np.arange(x0, x1, dtype=np.float64) + 0.5
    mass = c.sum()
    centre = (xs * c).sum() / mass
    offs = np.arange(-window, window + 1, dtype=np.float64)
    return centre, np.interp(offs + centre, xs, c, left=0, right=0), mass


def _edge(arr, rows, x0, x1, ink, paper, window):
    """Where the stroke is, which way it goes (px per px of height) and what it looks like, from the middle of `rows`."""
    ys, cs, ps = [], [], []
    for r in rows:
        c, p, _ = _stroke_row(arr, r, x0, x1, ink, paper, window)
        ys.append((r + 0.5) / SS)
        cs.append(c / SS)
        ps.append(p)
    k, b = np.polyfit(ys, cs, 1)
    y_mid = float(np.mean(ys))
    return y_mid, k * y_mid + b, k, np.mean(ps, axis=0)


def _hermite(y, y0, c0, s0, y1, c1, s1):
    h = y1 - y0
    t = (y - y0) / h
    return (2 * t**3 - 3 * t**2 + 1) * c0 + (t**3 - 2 * t**2 + t) * h * s0 + (-2 * t**3 + 3 * t**2) * c1 + (t**3 - t**2) * h * s1


def bridge(img, rows, x_span, ink, fill, outside='left', keep_rows=3.0, window=5, bump=0.0, shape=None):
    """
    Draws an outline that runs roughly up and down straight across the rows `rows` = (y0, y1) (pixels of the frame), where
    an arm or a foot interrupts it, and takes the arm off: in those rows, within the columns `x_span`, the picture is made
    again from one stroke that has the position and direction of the real stroke where the rows begin and end, and its
    look (width, softness). `outside` is the side of the stroke that is empty ('left' or 'right'); the other side is
    the body, `fill` (a colour). `img` is a frame made SS times as big. Choose rows that start and end where the outline is
    clean: the arm and its hook are between them. `bump`: how far (in pixels of the frame) the middle of the new stroke is
    drawn in towards the body (a negative number: out, away from it), as a smooth swell (the sine, squared) that is nothing
    at both ends and has no slope there, so that the new stroke runs into the old one without a corner (0 is straight, as
    the outline would be if nothing was between the rows). A swell that does have a slope at the ends (the plain sine) makes
    a corner where the new stroke meets the old, which shows once the picture is turned. `shape`: another way to draw the
    stroke than the curve between the two ends: a function that is given where the real stroke is at the two ends (the
    row, the column and the direction at the first end, then the same at the second) and returns a function of the row
    (in pixels of the frame) that gives the column of the middle of the new stroke. It has to start where the real stroke
    does and with the same direction; where it ends only matters as far as it is in view.
    """
    arr = np.asarray(img).copy()
    ink = np.array(ink, dtype=np.float64)
    fill = np.array(fill, dtype=np.float64)
    paper = fill
    x0, x1 = int(x_span[0] * SS), int(x_span[1] * SS)
    r_a, r_b = int(rows[0] * SS), int(rows[1] * SS)
    n = int(keep_rows * SS)
    w = int(window * SS)
    ya, ca, sa, pa = _edge(arr, range(r_a - n, r_a), x0, x1, ink, paper, w)
    yb, cb, sb, pb = _edge(arr, range(r_b, r_b + n), x0, x1, ink, paper, w)
    curve = shape(ya, ca, sa, yb, cb, sb) if shape is not None else None
    xs = np.arange(arr.shape[1], dtype=np.float64) + 0.5
    offs = np.arange(-w, w + 1, dtype=np.float64)
    cols = np.zeros(arr.shape[1], bool)
    cols[x0:x1] = True
    for r in range(r_a, r_b):
        y = (r + 0.5) / SS
        t = min(1.0, max(0.0, (y - ya) / (yb - ya)))
        prof = (1 - t) * pa + t * pb
        if curve is not None:
            centre = curve(y) * SS
        else:
            centre = _hermite(y, ya, ca, sa, yb, cb, sb) * SS
            # drawn in towards the body (to the right when the outside is on the left), most in the middle, and not at all at the ends
            centre += (1 if outside == 'left' else -1) * bump * SS * math.sin(math.pi * t) ** 2
        cov = np.interp(xs - centre, offs, prof, left=0, right=0)
        row = np.zeros((arr.shape[1], 4), dtype=np.float64)
        out = xs < centre if outside == 'left' else xs >= centre
        row[out, :3] = ink
        row[out, 3] = cov[out] * 255
        inn = ~out
        row[inn, :3] = fill[None, :] * (1 - cov[inn, None]) + ink[None, :] * cov[inn, None]
        row[inn, 3] = 255
        arr[r][cols] = np.round(row[cols]).astype(np.uint8)
    return Image.fromarray(arr, 'RGBA')


def head_arc(middle, half_width):
    """
    A `shape` for `bridge`: the lower outline of a round head, an ellipse that is `half_width` to each side of the column
    `middle` and that has the real outline's place and direction at the first end (the second end is not looked at: it is
    where the outline of the body goes on, and the head has none of that). The outline curves in under the cheek and comes
    round to the bottom of the head, as a face does, instead of running straight on into the side of the body.
    """

    def make(ya, ca, sa, yb, cb, sb):
        c = (middle - ca) / half_width  # how far out from the middle of the head the outline is there, in half widths
        u = math.sqrt(max(1e-9, 1 - c * c))  # how far down from the widest row of the head, in half heights
        height = half_width * u / (c * sa)  # the direction there says how high the head is
        widest = ya - u * height  # the row where the head is widest

        def curve(y):
            v = min(1.0, (y - widest) / height)
            return middle - half_width * math.sqrt(max(0.0, 1 - v * v))

        return curve

    return make


# --- hands ----------------------------------------------------------------------------------------------------------------


def round_hand(canvas, cx, cy, r, w, fill, ink):
    """A small round hand (an 'O') with its middle at (cx, cy), in pixels of the frame; r is the inside, w the outline."""
    d = ImageDraw.Draw(canvas)
    d.ellipse([(cx - r - w) * SS, (cy - r - w) * SS, (cx + r + w) * SS, (cy + r + w) * SS], fill=tuple(ink) + (255,))
    d.ellipse([(cx - r) * SS, (cy - r) * SS, (cx + r) * SS, (cy + r) * SS], fill=tuple(fill) + (255,))


# --- the picture for hiding behind a wall -----------------------------------------------------------------------------------


def peek_frames(bigs, size, tilt, face, wall_dx, bottom, hands, hand_r, hand_w, hand_fill, ink):
    """
    One picture for each of `bigs` (frames SS times as big, with whatever sticks out already taken off).
    tilt: degrees counter-clockwise, about `face` (x, y in frame pixels: the middle of the face).
    wall_dx: how far to the right of `face` the wall is. bottom: the row of the lowest thing of the body in view (in the
    first frame; nothing jumps when the ears move). hands: [(x, y)] the middles of the hands, x from the wall: the
    first at the top of the face, the second at the bottom, each on the outline of the head where it comes to the wall.
    """
    W, H = size
    out = []
    place = None
    for img in bigs:
        rot = img.rotate(tilt, resample=Image.BICUBIC, center=(face[0] * SS, face[1] * SS))
        dx = int(round((W - (face[0] + wall_dx)) * SS))
        canvas = Image.new('RGBA', (W * SS, H * SS), (0, 0, 0, 0))
        if dx >= 0:
            canvas.alpha_composite(rot, (dx, 0))
        else:
            canvas.alpha_composite(rot.crop((-dx, 0, W * SS, H * SS)), (0, 0))
        if place is None:
            place = canvas.getchannel('A').point(lambda v: 255 if v > 40 else 0).getbbox()[3] / SS
        dy = int(round((bottom - place) * SS))
        shifted = Image.new('RGBA', canvas.size, (0, 0, 0, 0))
        if dy >= 0:
            shifted.alpha_composite(canvas, (0, dy))
        else:
            shifted.alpha_composite(canvas.crop((0, -dy, W * SS, H * SS)), (0, 0))
        for x, y in hands:
            round_hand(shifted, W - x, y, hand_r, hand_w, hand_fill, ink)
        out.append(shifted.resize((W, H), Image.LANCZOS))
    return out


# --- the picture for hanging on the top edge of a window --------------------------------------------------------------------


def hang_frames(bigs, size, cut, face_x, hands_dx, feet, hand_r, hand_w, hand_fill, ink):
    """
    The head down to row `cut` of the frame (just under the mouth), moved down so that the cut lies on row `feet` (the
    pet's feet line: what stands on a window stands there), and nothing below it. Two round hands on the cut, `hands_dx` to
    each side of `face_x`.
    """
    W, H = size
    out = []
    shift = feet - cut
    for img in bigs:
        canvas = Image.new('RGBA', (W * SS, H * SS), (0, 0, 0, 0))
        canvas.alpha_composite(img.crop((0, 0, W * SS, int(cut * SS))), (0, int(shift * SS)))
        for sign in (-1, 1):
            round_hand(canvas, face_x + sign * hands_dx, feet, hand_r, hand_w, hand_fill, ink)
        # nothing below the edge
        a = canvas.getchannel('A')
        ImageDraw.Draw(a).rectangle([0, int(feet * SS), W * SS, H * SS], fill=0)
        canvas.putalpha(a)
        out.append(canvas.resize((W, H), Image.LANCZOS))
    return out


# --- checks -----------------------------------------------------------------------------------------------------------------


def extent(frames):
    """(top, bottom, left) of what is in view over all the frames, in pixels"""
    boxes = [f.getchannel('A').point(lambda v: 255 if v > 40 else 0).getbbox() for f in frames]
    return min(b[1] for b in boxes), max(b[3] for b in boxes), min(b[0] for b in boxes)


def sheet_of(frames):
    W, H = frames[0].size
    s = Image.new('RGBA', (W * len(frames), H), (0, 0, 0, 0))
    for i, f in enumerate(frames):
        s.paste(f, (i * W, 0))
    return s
