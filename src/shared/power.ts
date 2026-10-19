/** What the computer's battery reports: the charge from 0 to 1, and whether it is being charged. */
export interface Battery {
  level: number;
  charging: boolean;
}

/** The pet speaks up when the charge falls to this much on battery power. */
export const LOW_BATTERY = 0.2;
/** ...and may do so again once the battery has been charged, or has climbed past this. */
const REARM_ABOVE = 0.3;

/**
 * Reads the reports of the battery and tells when the charge has just run low. Every monitor's overlay sends the
 * same reports, so what matters is the change: one warning for each time the battery runs down.
 */
export class BatteryWatch {
  private armed = true;

  /** True once, when the charge falls to the warning level without a charger. */
  report(b: Battery): boolean {
    if (b.charging || b.level >= REARM_ABOVE) {
      this.armed = true;
      return false;
    }
    if (b.level > LOW_BATTERY || !this.armed) return false;
    this.armed = false;
    return true;
  }
}
