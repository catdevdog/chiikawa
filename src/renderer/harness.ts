import { SPEECH_LEVELS, type Mode, type Roam, type SpeechLevel } from '../engine/types';
import type { Settings, SkinInfo } from '../shared/types';

const MODE_LABELS: [Mode, string][] = [
  ['auto', 'auto'],
  ['follow', 'follow'],
  ['attach', 'attach'],
  ['wander', 'wander'],
];

/** The control strip of the browser test page. Not used inside Electron. */
export function mountHarness(opts: {
  settings: Settings;
  skins: SkinInfo[];
  patch(p: Partial<Settings>): void;
}): { setStatus(text: string): void; sync(s: Settings): void } {
  const panel = el('div', { id: 'harness' });
  const modes = new Map<Mode, HTMLButtonElement>();
  for (const [mode, label] of MODE_LABELS) {
    const b = el('button', { textContent: label });
    b.addEventListener('click', () => opts.patch({ mode }));
    modes.set(mode, b);
    panel.append(b);
  }

  const scale = el('input', { type: 'range', min: '0.5', max: '3', step: '0.25' });
  scale.addEventListener('input', () => opts.patch({ scale: Number(scale.value) }));
  const scaleLabel = el('span');

  const roam = el('select');
  for (const r of ['free', 'floor'] as Roam[]) roam.append(el('option', { value: r, textContent: r }));
  roam.addEventListener('change', () => opts.patch({ roam: roam.value as Roam }));

  const skin = el('select');
  for (const s of opts.skins) skin.append(el('option', { value: s.id, textContent: s.name }));
  skin.addEventListener('change', () => opts.patch({ skin: skin.value }));

  const speech = el('select');
  for (const level of SPEECH_LEVELS) speech.append(el('option', { value: level, textContent: `speech: ${level}` }));
  speech.addEventListener('change', () => opts.patch({ speech: speech.value as SpeechLevel }));

  const lock = el('input', { type: 'checkbox' });
  lock.addEventListener('change', () => opts.patch({ clickThrough: lock.checked }));
  const lockLabel = el('label', { textContent: 'click-through' });
  lockLabel.prepend(lock);

  const status = el('span', { id: 'status' });
  panel.append(scale, scaleLabel, roam, skin, speech, lockLabel, status);
  document.body.append(panel);

  const sync = (s: Settings): void => {
    for (const [mode, b] of modes) b.classList.toggle('on', mode === s.mode);
    scale.value = String(s.scale);
    scaleLabel.textContent = `x${s.scale}`;
    roam.value = s.roam;
    skin.value = s.skin;
    speech.value = s.speech;
    lock.checked = s.clickThrough;
  };
  sync(opts.settings);
  return { setStatus: (text) => void (status.textContent = text), sync };
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}): HTMLElementTagNameMap[K] {
  return Object.assign(document.createElement(tag), props);
}
