import { SPEECH_LEVELS, type Mode, type Roam, type SpeechLevel } from '../engine/types';
import { isMonitorChoice } from './displays';
import { isSkinId } from './ids';
import { DEFAULT_SETTINGS, MAX_FRIENDS, type Settings } from './types';

const MODES: Mode[] = ['auto', 'follow', 'attach', 'wander'];
const ROAMS: Roam[] = ['free', 'floor'];

/** Anything missing or invalid falls back to the default, so a hand-edited file cannot break startup. */
export function sanitizeSettings(raw: unknown): Settings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_SETTINGS;
  const scale =
    typeof r.scale === 'number' && Number.isFinite(r.scale) ? Math.min(4, Math.max(0.25, r.scale)) : d.scale;
  const skin = isSkinId(r.skin) ? r.skin : d.skin;
  return {
    mode: MODES.includes(r.mode as Mode) ? (r.mode as Mode) : d.mode,
    scale,
    roam: ROAMS.includes(r.roam as Roam) ? (r.roam as Roam) : d.roam,
    skin,
    clickThrough: r.clickThrough === true,
    autoStart: r.autoStart === true,
    autoUpdate: typeof r.autoUpdate === 'boolean' ? r.autoUpdate : d.autoUpdate,
    monitor: isMonitorChoice(r.monitor) ? r.monitor : d.monitor,
    speech: SPEECH_LEVELS.includes(r.speech as SpeechLevel) ? (r.speech as SpeechLevel) : d.speech,
    tricks: typeof r.tricks === 'boolean' ? r.tricks : d.tricks,
    friends: sanitizeFriends(r.friends, skin),
    perch: r.perch === true,
  };
}

/** The friends of a pet: skin ids, each once, never the main character itself, and no more than a pet can have. */
export function sanitizeFriends(raw: unknown, skin: string): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const id of raw) {
    if (isSkinId(id) && id !== skin && !out.includes(id)) out.push(id);
    if (out.length >= MAX_FRIENDS) break;
  }
  return out;
}
