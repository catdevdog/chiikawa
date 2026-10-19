import { isSkinId } from './ids.ts';
import { parseManifest, poseFiles } from './manifest.ts';

export interface SkinFile {
  name: string;
  data: Uint8Array;
}

/** What the skin maker asks to be saved: a skin id and its files (manifest.json plus PNGs). */
export interface SkinPayload {
  id: string;
  files: SkinFile[];
}

export const MAX_SKIN_FILES = 64;
export const MAX_SKIN_BYTES = 96 * 1024 * 1024;

const FILE_NAME = /^[A-Za-z0-9][\w.-]{0,63}\.(png|json)$/;
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47];

export type PayloadResult = { ok: true; payload: SkinPayload } | { ok: false; error: string };

const fail = (error: string): PayloadResult => ({ ok: false, error });

function toBytes(v: unknown): Uint8Array | null {
  if (v instanceof Uint8Array) return v;
  if (ArrayBuffer.isView(v)) return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  return null;
}

/**
 * Checks everything about a save request that can be checked without touching the disk. The main process
 * and the dev server both run it, so a bad request can never write outside the skin's own folder.
 */
export function validateSkinPayload(raw: unknown): PayloadResult {
  if (!raw || typeof raw !== 'object') return fail('empty request');
  const { id, files } = raw as Record<string, unknown>;
  if (!isSkinId(id)) return fail('invalid skin id');
  if (id === 'default') return fail('"default" is reserved for the built-in skin');
  if (!Array.isArray(files) || files.length < 2 || files.length > MAX_SKIN_FILES) return fail('invalid number of files');

  const out: SkinFile[] = [];
  const names = new Set<string>();
  let bytes = 0;
  for (const f of files) {
    if (!f || typeof f !== 'object') return fail('invalid file entry');
    const { name, data } = f as Record<string, unknown>;
    if (typeof name !== 'string' || !FILE_NAME.test(name)) return fail(`invalid file name: ${String(name)}`);
    if (names.has(name)) return fail(`duplicate file: ${name}`);
    names.add(name);
    const buf = toBytes(data);
    if (!buf || buf.length === 0) return fail(`empty file: ${name}`);
    bytes += buf.length;
    if (bytes > MAX_SKIN_BYTES) return fail('skin is too large');
    if (name.endsWith('.png') && !PNG_MAGIC.every((b, i) => buf[i] === b)) return fail(`not a PNG file: ${name}`);
    out.push({ name, data: buf });
  }

  const manifestFile = out.find((f) => f.name === 'manifest.json');
  if (!manifestFile) return fail('manifest.json is missing');
  try {
    const rawManifest = JSON.parse(new TextDecoder().decode(manifestFile.data));
    const manifest = parseManifest(rawManifest, id);
    if (Object.keys(rawManifest.poses).length !== Object.keys(manifest.poses).length) {
      return fail('manifest has invalid pose entries');
    }
    for (const file of poseFiles(manifest)) {
      if (!names.has(file)) return fail(`manifest refers to a missing file: ${file}`);
    }
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'invalid manifest');
  }
  return { ok: true, payload: { id, files: out } };
}
