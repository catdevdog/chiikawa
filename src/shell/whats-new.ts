import { app, Notification, shell } from 'electron';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { announcement, parseChangelog, summarize } from '../shared/changelog';
import { t } from './i18n';
import { log } from './log';

/** The page of a release on GitHub, where its changes are written out in full. */
export const releasePage = (version: string): string => `https://github.com/catdevdog/chiikawa/releases/tag/v${version}`;

const stateFile = (): string => path.join(app.getPath('userData'), 'state.json');

/** The version this profile last ran as, or null on a profile that never recorded one. */
function readSeenVersion(): string | null {
  try {
    const v = (JSON.parse(readFileSync(stateFile(), 'utf8')) as { lastVersion?: unknown }).lastVersion;
    return typeof v === 'string' && /^\d+\.\d+\.\d+$/.test(v) ? v : null;
  } catch {
    return null;
  }
}

function writeSeenVersion(version: string): void {
  try {
    mkdirSync(path.dirname(stateFile()), { recursive: true });
    writeFileSync(stateFile(), JSON.stringify({ lastVersion: version }, null, 2));
  } catch {
    // a read-only profile just means the notice comes again next time
  }
}

/** CHANGELOG.md travels inside the app; an app without it has nothing to announce. */
function readChangelog() {
  try {
    return parseChangelog(readFileSync(path.join(app.getAppPath(), 'CHANGELOG.md'), 'utf8'));
  } catch (err) {
    log('warn', `could not read CHANGELOG.md: ${String(err)}`);
    return [];
  }
}

export interface Announced {
  version: string;
  title: string;
  body: string;
}

/**
 * Tells the user what the update they just got changed, once. `returning` says the app had run on this computer
 * before this version started recording what it ran as (so the first start of an updated app is not mistaken for an
 * install). Returns what it showed, or null when there was nothing to say.
 */
export function announceChanges(returning: boolean, show: (a: Announced) => void = showNotice): Announced | null {
  const current = app.getVersion();
  const seen = readSeenVersion();
  if (seen === current) return null;
  const news = announcement(readChangelog(), { current, seen, returning });
  writeSeenVersion(current);
  if (news.length === 0) return null;
  const announced = { version: current, title: t().whatsNewTitle(current), body: summarize(news) };
  log('info', `what's new in v${current}: ${news.map((e) => e.version).join(', ')}`);
  show(announced);
  return announced;
}

/** Kept while it is up: a notification that is collected as garbage never hears the click. */
let shown: Notification | null = null;

function showNotice(a: Announced): void {
  try {
    if (!Notification.isSupported()) return;
    shown = new Notification({ title: a.title, body: a.body, silent: true });
    shown.on('click', () => void shell.openExternal(releasePage(a.version)));
    shown.show();
  } catch (err) {
    log('warn', `could not show the notice of what changed: ${String(err)}`);
  }
}
