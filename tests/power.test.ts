import { describe, expect, it } from 'vitest';
import { BatteryWatch, LOW_BATTERY } from '../src/shared/power';
import { parseBattery } from '../src/shared/validate';

const on = (level: number) => ({ level, charging: false });
const charging = (level: number) => ({ level, charging: true });

describe('BatteryWatch', () => {
  it('stays quiet while the battery is well charged, or on the charger', () => {
    const w = new BatteryWatch();
    expect(w.report(on(1))).toBe(false);
    expect(w.report(on(0.5))).toBe(false);
    expect(w.report(on(0.21))).toBe(false);
    expect(w.report(charging(0.05))).toBe(false);
  });

  it('warns once when the charge falls to the warning level', () => {
    const w = new BatteryWatch();
    expect(w.report(on(0.3))).toBe(false);
    expect(w.report(on(LOW_BATTERY))).toBe(true);
    expect(w.report(on(0.19))).toBe(false);
    expect(w.report(on(0.1))).toBe(false);
  });

  it('hears the same report from every monitor without warning again', () => {
    const w = new BatteryWatch();
    expect(w.report(on(0.18))).toBe(true);
    expect(w.report(on(0.18))).toBe(false);
    expect(w.report(on(0.18))).toBe(false);
  });

  it('warns about a battery that is already low when the app starts', () => {
    expect(new BatteryWatch().report(on(0.12))).toBe(true);
  });

  it('warns again after the battery has been charged', () => {
    const w = new BatteryWatch();
    expect(w.report(on(0.15))).toBe(true);
    expect(w.report(charging(0.16))).toBe(false);
    expect(w.report(on(0.15))).toBe(true);
  });

  it('warns again after the charge has climbed back up, even without noticing the charger', () => {
    const w = new BatteryWatch();
    expect(w.report(on(0.15))).toBe(true);
    // between the warning level and the level that re-arms: still the same run-down
    expect(w.report(on(0.25))).toBe(false);
    expect(w.report(on(0.15))).toBe(false);
    expect(w.report(on(0.6))).toBe(false);
    expect(w.report(on(0.15))).toBe(true);
  });
});

describe('parseBattery', () => {
  it('reads the charge and the charger', () => {
    expect(parseBattery({ level: 0.42, charging: true })).toEqual({ level: 0.42, charging: true });
    expect(parseBattery({ level: 0, charging: false, extra: 1 })).toEqual({ level: 0, charging: false });
  });

  it('pulls a charge out of range back in', () => {
    expect(parseBattery({ level: 7, charging: false })!.level).toBe(1);
    expect(parseBattery({ level: -2, charging: false })!.level).toBe(0);
  });

  it('refuses anything else', () => {
    for (const bad of [null, undefined, 'low', 5, [], {}, { level: 0.5 }, { charging: true }, { level: '0.5', charging: true }, { level: NaN, charging: true }, { level: Infinity, charging: true }, { level: 0.5, charging: 'yes' }]) {
      expect(parseBattery(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});
