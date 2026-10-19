import type { Particle, PetView } from '../engine/types';
import type { Skin } from './skin';

export interface DrawOptions {
  /** outline the hitbox and feet point */
  debug?: boolean;
}

export function drawScene(
  ctx: CanvasRenderingContext2D,
  v: PetView,
  skin: Skin,
  world: { width: number; height: number },
  opts: DrawOptions = {},
): void {
  ctx.clearRect(0, 0, world.width, world.height);
  drawShadow(ctx, v, skin);
  drawPet(ctx, v, skin);
  drawParticles(ctx, v.particles);
  if (opts.debug) drawDebug(ctx, v);
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
  const frame = skin.spriteFor(v.state).frameAt(v.t * 1000);
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

function drawParticles(ctx: CanvasRenderingContext2D, particles: readonly Particle[]): void {
  for (const p of particles) {
    const life = p.age / p.life;
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, (1 - life) * 1.6));
    if (p.kind === 'heart') drawHeart(ctx, p.x, p.y, 7 + life * 5);
    else drawZ(ctx, p.x, p.y, 12 + life * 10);
    ctx.restore();
  }
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
