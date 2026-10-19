import { app } from 'electron';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { sanitizeSettings } from '../shared/sanitize';
import { DEFAULT_SETTINGS, type Settings } from '../shared/types';

const file = (): string => path.join(app.getPath('userData'), 'settings.json');

export function loadSettings(): Settings {
  try {
    return sanitizeSettings(JSON.parse(readFileSync(file(), 'utf8')));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: Settings): void {
  try {
    mkdirSync(path.dirname(file()), { recursive: true });
    writeFileSync(file(), JSON.stringify(settings, null, 2));
  } catch {
    // a read-only profile just means settings are not remembered
  }
}
