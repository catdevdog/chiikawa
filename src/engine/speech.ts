import { SAY_EVENTS, type Line, type Lines, type SayEvent, type SayStyle, type SpeechLevel } from './types';

export const MAX_LINE_CHARS = 40;
export const MAX_LINES_PER_EVENT = 16;

/**
 * Sounds and short cries rise and fade like the z's; sentences stay above the head for a moment. A line of one
 * word is a sound up to 14 characters; several words only count as a sound when they are short ("하아? 하아?").
 */
export function classify(text: string): SayStyle {
  const chars = [...text.replace(/\s+/g, '')].length;
  const words = text.trim().split(/\s+/).length;
  if (words <= 1) return chars <= 14 ? 'float' : 'hold';
  return chars <= 6 ? 'float' : 'hold';
}

/**
 * The `lines` of a skin manifest: `{ "click": ["하아?", { "text": "...", "style": "hold" }] }`.
 * Unknown situations, empty or non-text entries and anything past the limits are dropped.
 */
export function parseLines(raw: unknown): Lines {
  if (!raw || typeof raw !== 'object') return {};
  const out: Lines = {};
  for (const event of SAY_EVENTS) {
    const list = (raw as Record<string, unknown>)[event];
    if (!Array.isArray(list)) continue;
    const lines: Line[] = [];
    for (const item of list) {
      const obj = item && typeof item === 'object' ? (item as Record<string, unknown>) : null;
      const source = typeof item === 'string' ? item : typeof obj?.text === 'string' ? obj.text : null;
      if (source === null) continue;
      const text = [...source.replace(/\p{Cc}/gu, ' ').replace(/\s+/g, ' ').trim()].slice(0, MAX_LINE_CHARS).join('');
      if (!text) continue;
      const wanted = obj?.style;
      lines.push({ text, style: wanted === 'float' || wanted === 'hold' ? wanted : classify(text) });
      if (lines.length >= MAX_LINES_PER_EVENT) break;
    }
    if (lines.length > 0) out[event] = lines;
  }
  return out;
}

/** A rough width of `text` set at `size` px: letters narrow, Hangul, kana and other wide characters a full em. */
export function textWidth(text: string, size: number): number {
  let em = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if (c <= 0x20) em += 0.3;
    else if (c < 0x250) em += /[.,!?:;'"~·-]/.test(ch) ? 0.45 : 0.6;
    else em += 1;
  }
  return em * size * 1.05;
}

interface Rule {
  /** how likely a chance to speak is taken */
  chance: number;
  /** ms before this situation may speak again */
  cooldown: number;
  /** only spoken at level "all": the pet talking to itself, not answering */
  murmur?: boolean;
  /** may cut in while other words are still up */
  urgent?: boolean;
}

const RULES: Record<SayEvent, Rule> = {
  start: { chance: 1, cooldown: 0, urgent: true },
  hover: { chance: 0.3, cooldown: 9_000 },
  click: { chance: 1, cooldown: 400, urgent: true },
  rub: { chance: 0.8, cooldown: 2_500 },
  triple: { chance: 1, cooldown: 1_500, urgent: true },
  pickup: { chance: 1, cooldown: 1_200, urgent: true },
  throw: { chance: 1, cooldown: 1_000, urgent: true },
  land: { chance: 0.7, cooldown: 3_000 },
  flee: { chance: 1, cooldown: 4_000, urgent: true },
  follow: { chance: 0.4, cooldown: 25_000 },
  attach: { chance: 1, cooldown: 20_000 },
  idle: { chance: 1, cooldown: 30_000, murmur: true },
  sit: { chance: 0.35, cooldown: 30_000, murmur: true },
  sleep: { chance: 0.8, cooldown: 20_000 },
  wake: { chance: 1, cooldown: 8_000 },
  cross: { chance: 0.7, cooldown: 20_000 },
};

/** Two lines never come closer than this, unless the second one is an urgent answer. */
const GAP_MS = 900;

/**
 * Decides whether the pet says something and which line: a skin's lines, how often each situation may speak,
 * and never the same line twice in a row. Without lines it does nothing and uses no random numbers.
 */
export class Speaker {
  /** For previews and tests: every situation speaks, and much more often. */
  chatty = false;
  private lines: Lines = {};
  private level: SpeechLevel = 'all';
  private spoke = new Map<SayEvent, number>();
  private said = new Map<SayEvent, string>();
  private lastAny = -Infinity;

  constructor(private readonly rng: () => number) {}

  setLines(lines: Lines | null): void {
    this.lines = lines ?? {};
  }

  setLevel(level: SpeechLevel): void {
    this.level = level;
  }

  /** Does the skin have anything to say at all? */
  get any(): boolean {
    return SAY_EVENTS.some((e) => (this.lines[e]?.length ?? 0) > 0);
  }

  /** The line for `event` at time `now` (ms), or null. `busy`: held words are still up. */
  pick(event: SayEvent, now: number, busy: boolean): Line | null {
    const pool = this.lines[event];
    if (this.level === 'off' || !pool || pool.length === 0) return null;
    const rule = RULES[event];
    if (rule.murmur && this.level !== 'all') return null;
    const cooldown = this.chatty ? rule.cooldown / 5 : rule.cooldown;
    if (now - (this.spoke.get(event) ?? -Infinity) < cooldown) return null;
    if (!rule.urgent && (busy || now - this.lastAny < (this.chatty ? GAP_MS / 3 : GAP_MS))) return null;
    if (!this.chatty && rule.chance < 1 && this.rng() >= rule.chance) return null;
    let i = Math.floor(this.rng() * pool.length) % pool.length;
    if (pool.length > 1 && pool[i]!.text === this.said.get(event)) i = (i + 1) % pool.length;
    const line = pool[i]!;
    this.spoke.set(event, now);
    this.said.set(event, line.text);
    this.lastAny = now;
    return line;
  }
}
