// supportKey shim — the desktop build generates `src/main/generated/supportKey.ts`
// from a secret used to mint/verify developer support codes. The web app never
// issues those codes, so a fixed placeholder keeps `recovery.ts` bundling without
// shipping the real secret to the worker.
export const SUPPORT_KEY_HEX =
  '0000000000000000000000000000000000000000000000000000000000000000';
