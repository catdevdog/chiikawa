import { app, screen, type Display } from 'electron';
import { parseFakeDisplays, type DisplayInfo } from '../shared/displays';

/**
 * Made-up monitors for tests (a single X display can only show one real monitor). Never used by an installed
 * app: BUDDY_FAKE_DISPLAYS is read, and the list can be replaced from a test, only when running unpackaged.
 */
let fake: DisplayInfo[] | null = !app.isPackaged && process.env.BUDDY_FAKE_DISPLAYS ? parseFakeDisplays(process.env.BUDDY_FAKE_DISPLAYS) : null;

export function setFakeDisplays(list: DisplayInfo[] | null): void {
  if (!app.isPackaged) fake = list;
}

const describe = (d: Display, primaryId: number): DisplayInfo => ({
  id: d.id,
  label: d.label,
  primary: d.id === primaryId,
  workArea: { x: d.workArea.x, y: d.workArea.y, width: d.workArea.width, height: d.workArea.height },
  bounds: { x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height },
  scaleFactor: d.scaleFactor,
});

/** Every monitor that is connected right now. */
export function readDisplays(): DisplayInfo[] {
  if (fake) return fake.map((d) => ({ ...d, workArea: { ...d.workArea }, bounds: { ...d.bounds } }));
  const primary = screen.getPrimaryDisplay().id;
  return screen.getAllDisplays().map((d) => describe(d, primary));
}
