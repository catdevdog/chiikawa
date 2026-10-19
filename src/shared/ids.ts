/** Skin ids are folder names: letters, digits, `_`, `-`, `.`, but never only dots (`.`, `..`). */
const SKIN_ID = /^(?!\.+$)[\w.-]+$/;

export const isSkinId = (v: unknown): v is string => typeof v === 'string' && SKIN_ID.test(v);
