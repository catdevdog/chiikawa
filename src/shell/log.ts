import { app } from 'electron';
import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import path from 'node:path';

const MAX_BYTES = 512 * 1024;
let file: string | null = null;

function logFile(): string {
  if (file) return file;
  const dir = app.getPath('userData');
  mkdirSync(dir, { recursive: true });
  file = path.join(dir, 'buddy.log');
  try {
    if (statSync(file).size > MAX_BYTES) renameSync(file, `${file}.1`);
  } catch {
    // no log yet
  }
  return file;
}

/** Appends to <userData>/buddy.log so problems on someone else's PC can be diagnosed. */
export function log(level: 'info' | 'warn' | 'error', message: string): void {
  try {
    appendFileSync(logFile(), `${new Date().toISOString()} [${level}] ${message}\n`);
  } catch {
    // logging must never take the app down
  }
  if (!app.isPackaged) console[level === 'info' ? 'log' : level](message);
}
