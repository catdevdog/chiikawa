import path from 'node:path';

/** Joins `rel` onto `base` and refuses anything that would leave `base`. */
export function safeJoin(base: string, rel: string): string | null {
  if (rel.includes('\\') || rel.includes('\0') || rel.includes(':')) return null;
  const resolved = path.resolve(base, '.' + path.posix.normalize('/' + rel));
  return resolved === base || resolved.startsWith(base + path.sep) ? resolved : null;
}
