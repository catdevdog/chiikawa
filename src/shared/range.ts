/** The part of a file that a `Range: bytes=...` header asks for, both ends included. */
export interface ByteRange {
  start: number;
  end: number;
}

/**
 * Reads the Range header of a request for a file of `size` bytes. Null: there is none (or it is not one this reads: send the
 * whole file). 'unsatisfiable': it asks for something past the end. A video or a sound is asked for in pieces, so that it can
 * start before it is all there and jump about.
 */
export function parseRange(header: string | null, size: number): ByteRange | 'unsatisfiable' | null {
  const m = /^bytes=(\d*)-(\d*)$/.exec((header ?? '').trim());
  if (!m || (m[1] === '' && m[2] === '')) return null;
  if (m[1] === '') {
    // the last n bytes
    const n = Number(m[2]);
    return n > 0 && size > 0 ? { start: Math.max(0, size - n), end: size - 1 } : 'unsatisfiable';
  }
  const start = Number(m[1]);
  const end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  return start < size && start <= end ? { start, end } : 'unsatisfiable';
}
