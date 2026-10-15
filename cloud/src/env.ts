// Cloudflare binding types for the Rokar POS web foundation.
//
// ACCOUNTS: one D1 database holding every registered shop + web session (the
//           only async, web-native code in the project).
// SHOP:     one SQLite-backed Durable Object *per shop*. Each ShopObject runs
//           the full 50-migration POS schema and dispatches the real
//           `src/main/services/*` (nearly unchanged) inside transactionSync.
export interface Env {
  ACCOUNTS: D1Database;
  SHOP: DurableObjectNamespace;
  // Static-assets binding for the web build of the desktop renderer (served at /app).
  ASSETS?: Fetcher;
}