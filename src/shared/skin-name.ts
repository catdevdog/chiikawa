/** The languages the app is shown in. */
export type Lang = 'ko' | 'en';

export const LANGS: readonly Lang[] = ['ko', 'en'];

/** A skin's names by language, as the manifest's `names` (`{ "ko": "치이카와" }`). Anything else in there is dropped. */
export function parseNames(raw: unknown): Partial<Record<Lang, string>> {
  const out: Partial<Record<Lang, string>> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const lang of LANGS) {
    const v = (raw as Record<string, unknown>)[lang];
    if (typeof v !== 'string') continue;
    const name = [...v.replace(/\p{Cc}/gu, ' ').trim()].slice(0, 40).join('');
    if (name) out[lang] = name;
  }
  return out;
}

/** The name a skin goes by in the menu: its name in this language if it has one, else its plain name, else its folder. */
export function skinTitle(manifest: { name?: unknown; names?: unknown }, lang: Lang, id: string): string {
  const plain = typeof manifest.name === 'string' ? manifest.name.trim() : '';
  return parseNames(manifest.names)[lang] ?? (plain || id);
}
