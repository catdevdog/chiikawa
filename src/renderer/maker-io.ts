import type { Raster } from '../maker/process';
import type { SkinPayload } from '../shared/skin-payload';

/** Longest side kept while editing; the finished skin is at most 320px anyway. */
const MAX_INPUT = 720;

const TYPES: Record<string, string> = {
  gif: 'image/gif',
  png: 'image/png',
  apng: 'image/png',
  webp: 'image/webp',
  avif: 'image/avif',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
};

export interface Decoded {
  frames: Raster[];
  /** ms per frame */
  durations: number[];
}

function toRaster(src: CanvasImageSource, w: number, h: number): Raster {
  const k = Math.min(1, MAX_INPUT / Math.max(w, h));
  const tw = Math.max(1, Math.round(w * k));
  const th = Math.max(1, Math.round(h * k));
  const ctx = new OffscreenCanvas(tw, th).getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, tw, th);
  return { width: tw, height: th, data: ctx.getImageData(0, 0, tw, th).data };
}

/** Reads a png/gif/apng/webp/jpg file into RGBA frames (every frame of an animation). */
export async function decodeFile(file: File): Promise<Decoded> {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  const type = file.type || TYPES[ext] || '';
  const bytes = await file.arrayBuffer();
  if (type && typeof ImageDecoder !== 'undefined') {
    try {
      const decoder = new ImageDecoder({ data: bytes, type });
      try {
        await decoder.tracks.ready;
        const count = decoder.tracks.selectedTrack?.frameCount ?? 1;
        const frames: Raster[] = [];
        const durations: number[] = [];
        for (let i = 0; i < count; i++) {
          const { image } = await decoder.decode({ frameIndex: i });
          frames.push(toRaster(image, image.displayWidth, image.displayHeight));
          // browsers treat 0 / very short GIF delays as ~100ms
          durations.push(image.duration && image.duration >= 20_000 ? image.duration / 1000 : 100);
          image.close();
        }
        return { frames, durations };
      } finally {
        decoder.close();
      }
    } catch (err) {
      console.warn(`ImageDecoder failed for ${file.name}, decoding it as a still image`, err);
    }
  }
  const bitmap = await createImageBitmap(new Blob([bytes], { type }));
  try {
    return { frames: [toRaster(bitmap, bitmap.width, bitmap.height)], durations: [100] };
  } finally {
    bitmap.close();
  }
}

export const toImageData = (r: Raster): ImageData => new ImageData(r.data as unknown as ImageDataArray, r.width, r.height);

export async function rasterToPng(r: Raster): Promise<Uint8Array> {
  const canvas = new OffscreenCanvas(r.width, r.height);
  canvas.getContext('2d')!.putImageData(toImageData(r), 0, 0);
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return new Uint8Array(await blob.arrayBuffer());
}

export function rasterToBitmap(r: Raster): Promise<ImageBitmap> {
  return createImageBitmap(toImageData(r));
}

export type SaveResult = { ok: true; where: string } | { ok: false; error: string };

/** Where finished skins go: the app's skin folder (Electron) or ./skins through the dev server. */
export interface MakerHost {
  readonly kind: 'electron' | 'dev';
  /** ids of skins that already exist, to warn before overwriting */
  existing(): Promise<string[]>;
  save(payload: SkinPayload): Promise<SaveResult>;
  /** Electron only: make the desktop pet use the skin right away */
  apply?(id: string): Promise<void>;
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function pickMakerHost(): MakerHost {
  const api = window.buddyMaker;
  if (api) return { kind: 'electron', existing: () => api.existing(), save: (p) => api.save(p), apply: (id) => api.apply(id) };
  return {
    kind: 'dev',
    async existing() {
      const list: { id: string }[] = await fetch('/skins/index.json').then((r) => r.json()).catch(() => []);
      return list.map((s) => s.id);
    },
    async save(payload) {
      const res = await fetch('/__maker/save', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-maker': '1' },
        body: JSON.stringify({ id: payload.id, files: payload.files.map((f) => ({ name: f.name, data: toBase64(f.data) })) }),
      });
      const body = (await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }))) as SaveResult;
      return body;
    },
  };
}
