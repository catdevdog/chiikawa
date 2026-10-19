import type { Frame } from './skin';

/** The longest side of the canvas a picture is measured on: plenty to count pixels by, and cheap to read back. */
const SIDE = 96;
/** A pixel this opaque (of 255) is part of the character; fainter ones are the soft edge or a shadow. */
const SOLID = 48;

/**
 * How big a character looks: the side of a square with the area of the opaque part of its picture, in the pixels of
 * the sprite box at scale 1. The picture is placed the way `drawPet` places it (fitted into the box, bottom-centred).
 * Null when it cannot be measured (the canvas is not there, or the browser will not let a picture be read back).
 */
export function measureBody(frame: Frame, box: { w: number; h: number }): number | null {
  try {
    const r = Math.min(1, SIDE / Math.max(box.w, box.h));
    const cw = Math.max(1, Math.round(box.w * r));
    const ch = Math.max(1, Math.round(box.h * r));
    const canvas = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(cw, ch) : Object.assign(document.createElement('canvas'), { width: cw, height: ch });
    const ctx = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!ctx) return null;
    const fit = Math.min(cw / frame.width, ch / frame.height);
    const dw = frame.width * fit;
    const dh = frame.height * fit;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(frame.image, (cw - dw) / 2, ch - dh, dw, dh);
    const { data } = ctx.getImageData(0, 0, cw, ch);
    let solid = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i]! >= SOLID) solid++;
    return solid > 0 ? Math.sqrt(solid) / r : null;
  } catch {
    return null;
  }
}
