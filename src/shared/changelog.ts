/**
 * CHANGELOG.md tells people what a version changed: a `## 1.2.3` heading per version, and under it one `- ` line per
 * change they would notice. A line is a few sentences; a notification shows only the first one.
 */
export interface ChangelogEntry {
  version: string;
  changes: string[];
}

const HEADING = /^##\s+v?(\d+\.\d+\.\d+)\s*$/;
const BULLET = /^[-*]\s+(.+)$/;

export function parseChangelog(text: string): ChangelogEntry[] {
  const entries: ChangelogEntry[] = [];
  let current: ChangelogEntry | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const heading = HEADING.exec(line);
    if (heading) {
      current = { version: heading[1]!, changes: [] };
      entries.push(current);
    } else if (line.startsWith('## ')) {
      // some other section: its bullets are not a version's changes
      current = null;
    } else {
      const bullet = BULLET.exec(line);
      if (current && bullet) current.changes.push(bullet[1]!.trim());
    }
  }
  return entries;
}

/** Negative when `a` is the older version, positive when it is the newer one. Both are `major.minor.patch`. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * The versions to tell the user about at start-up, newest first. `seen` is the version the app last ran as, if it
 * ever recorded one. A first run tells nothing; a machine that had the app before this was recorded gets the
 * current version's changes only, since nobody knows how far back it was.
 */
export function announcement(entries: readonly ChangelogEntry[], o: { current: string; seen: string | null; returning: boolean }): ChangelogEntry[] {
  if (o.seen === o.current) return [];
  const upToNow = entries.filter((e) => e.changes.length > 0 && compareVersions(e.version, o.current) <= 0);
  const news =
    o.seen === null
      ? o.returning
        ? upToNow.filter((e) => e.version === o.current)
        : []
      : upToNow.filter((e) => compareVersions(e.version, o.seen!) > 0);
  return news.sort((a, b) => compareVersions(b.version, a.version));
}

/** The first sentence of a change (up to the first period that ends a word): what a notification has room for. */
export const headline = (change: string): string => {
  const text = change.trim();
  return /^.+?\.(?=\s|$)/s.exec(text)?.[0] ?? text;
};

/** A few short lines for a notification: the headlines, newest first, and how many more there are. */
export function summarize(entries: readonly ChangelogEntry[], maxLines = 4): string {
  const all = entries.flatMap((e) => e.changes.map(headline));
  const more = all.length - maxLines;
  const lines = all.slice(0, more > 0 ? maxLines - 1 : maxLines);
  const rest = all.length - lines.length;
  return [...lines.map((l) => `- ${l}`), ...(rest > 0 ? [`외 ${rest}가지가 더 있습니다.`] : [])].join('\n');
}
