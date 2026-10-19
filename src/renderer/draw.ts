import type { Particle, PetView } from '../engine/types';
import type { Skin } from './skin';

export interface DrawOptions {
  /** outline the hitbox and feet point */
  debug?: boolean;
}

/** The part of the shared screen space this canvas shows: where its corner is, and how big it is. */
export interface Viewport {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Draws the pet, whose position is in the shared screen space, into a canvas that shows only `view` of it. */
export function drawScene(ctx: CanvasRenderingContext2D, v: PetView, skin: Skin, view: Viewport, opts: DrawOptions = {}): void {
  ctx.clearRect(0, 0, view.width, view.height);
  ctx.save();
  ctx.translate(-view.x, -view.y);
  drawShadow(ctx, v, skin);
  drawPet(ctx, v, skin);
  drawParticles(ctx, v.particles, skin.textColor);
  if (opts.debug) drawDebug(ctx, v);
  ctx.restore();
}

function drawShadow(ctx: CanvasRenderingContext2D, v: PetView, skin: Skin): void {
  // nothing underneath a pet that is hanging or in the air
  if (v.pivot === 'top' || v.state === 'fall') return;
  const rx = skin.box.w * v.scale * 0.3 * (1 - Math.min(v.lift / (60 * v.scale), 0.4));
  ctx.save();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.11)';
  ctx.beginPath();
  ctx.ellipse(v.x, v.y - 2 * v.scale, rx, rx * 0.22, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawPet(ctx: CanvasRenderingContext2D, v: PetView, skin: Skin): void {
  const frame = skin.spriteFor(v.state, v.action).frameAt(v.t * 1000);
  const { w: bw, h: bh, anchorX, anchorY } = skin.box;
  // artwork that animates itself skips the engine's hop and squash; a hanging pet still swings
  const own = skin.motionOff(v.state);
  const sx = own ? 1 : v.sx;
  const sy = own ? 1 : v.sy;
  const lift = own ? 0 : v.lift;
  const rot = own && v.pivot !== 'top' ? 0 : v.rot;
  // fit the frame into the sprite box, bottom-centred
  const fit = Math.min(bw / frame.width, bh / frame.height);
  const dw = frame.width * fit;
  const dh = frame.height * fit;
  const dx = (bw - dw) / 2;
  const dy = bh - dh;

  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.translate(v.x, v.y - lift);
  if (rot) {
    // rotation happens in screen space, so mirroring the sprite does not mirror the swing
    const pivotY = v.pivot === 'top' ? -anchorY * bh * v.scale : 0;
    ctx.translate(0, pivotY);
    ctx.rotate(rot);
    ctx.translate(0, -pivotY);
  }
  ctx.scale(v.facing * skin.artFacing * v.scale, v.scale);
  ctx.scale(sx, sy);
  ctx.drawImage(frame.image, -anchorX * bw + dx, -anchorY * bh + dy, dw, dh);
  ctx.restore();
}

function drawParticles(ctx: CanvasRenderingContext2D, particles: readonly Particle[], textColor: string): void {
  for (const p of particles) {
    if (p.kind === 'text') {
      drawWords(ctx, p, textColor);
      continue;
    }
    const life = p.age / p.life;
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, (1 - life) * 1.6));
    if (p.kind === 'heart') drawHeart(ctx, p.x, p.y, 7 + life * 5);
    else drawZ(ctx, p.x, p.y, 12 + life * 10);
    ctx.restore();
  }
}

/** Korean first (Windows ships Malgun Gothic), then the usual fonts of the other systems. */
const WORDS_FONT = '"Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans KR", "Noto Sans CJK KR", "Segoe UI", system-ui, sans-serif';

/**
 * What the pet says, drawn like the z's and hearts: coloured letters with a white outline, no bubble. Sounds swell a
 * little as they rise and fade over the second half; a sentence pops in, stays, and fades at the end.
 */
function drawWords(ctx: CanvasRenderingContext2D, p: Particle, color: string): void {
  if (!p.text) return;
  const life = Math.max(0, Math.min(1, p.age / p.life));
  const held = p.style === 'hold';
  const alpha = Math.min(1, p.age / 140, (1 - life) / (held ? 0.2 : 0.5));
  if (alpha <= 0) return;
  const base = p.size ?? 16;
  const pop = 1 - (1 - Math.min(1, p.age / 180)) ** 3;
  const size = held ? base * (0.88 + 0.12 * pop) : base * (1 + life * 0.3);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = `bold ${size}px ${WORDS_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(3, size * 0.3);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.96)';
  ctx.fillStyle = color;
  ctx.strokeText(p.text, p.x, p.y);
  ctx.fillText(p.text, p.x, p.y);
  ctx.restore();
}

function drawHeart(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  ctx.fillStyle = '#ff6b8b';
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x, y + s * 0.9);
  ctx.bezierCurveTo(x - s * 1.5, y - s * 0.1, x - s * 0.8, y - s * 1.1, x, y - s * 0.4);
  ctx.bezierCurveTo(x + s * 0.8, y - s * 1.1, x + s * 1.5, y - s * 0.1, x, y + s * 0.9);
  ctx.closePath();
  ctx.stroke();
  ctx.fill();
}

function drawZ(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  ctx.font = `bold ${size}px "Segoe UI", system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.fillStyle = '#6f8cff';
  ctx.strokeText('z', x, y);
  ctx.fillText('z', x, y);
}

function drawDebug(ctx: CanvasRenderingContext2D, v: PetView): void {
  const r = v.hitbox;
  ctx.save();
  ctx.strokeStyle = 'rgba(255, 0, 90, 0.8)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeRect(r.x, r.y, r.w, r.h);
  ctx.fillStyle = 'rgba(255, 0, 90, 0.9)';
  ctx.fillRect(v.x - 2, v.y - 2, 4, 4);
  ctx.restore();
}
