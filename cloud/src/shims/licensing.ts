// licensing shim — `sales.ts` calls `licensing.ensureLicenseValidSync()` on every
// sale. Desktop licensing is a device-locked, one-time purchase enforced against a
// remote server, and a shop with no key would be refused there. The web app is
// gated by the shop's PLAN at `/api/rpc` instead, so the per-sale check is a no-op.
//
// The `licensing:*` Settings channels still run the REAL service: `dispatch.ts`
// imports it through the `@desktop/licensing` virtual specifier (see build.mjs),
// which is unaffected by this relative-path alias.

export function ensureLicenseValidSync(): void {}
export function ensureLicenseValid(): Promise<void> {
  return Promise.resolve();
}
export function checkLicense(): Promise<void> {
  return Promise.resolve();
}
export function activateLicense(_key?: string): Promise<string> {
  return Promise.resolve('License activation is managed from the web account page.');
}
export function trialStatus(): Promise<unknown> {
  return Promise.resolve({ trial: false, source: 'web' });
}
