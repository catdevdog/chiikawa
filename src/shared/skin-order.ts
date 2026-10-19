import type { SkinInfo } from './types';

/** The order of the skin menu: the skins that ship with the app first, then the user's own, each group by name. */
export function sortSkins(list: readonly SkinInfo[]): SkinInfo[] {
  return [...list].sort(
    (a, b) =>
      Number(b.builtin) - Number(a.builtin) ||
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) ||
      a.id.localeCompare(b.id),
  );
}
