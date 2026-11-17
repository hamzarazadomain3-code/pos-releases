/**
 * The cloud build aliases `bwip-js` to an inert shim (a Worker cannot render a
 * barcode bitmap), so the cloud typecheck only needs the module to EXIST.
 *
 * The real types are checked by the desktop build (tsconfig.main.json, node
 * resolution), which is where `printDocs.ts` actually runs.
 */
declare module 'bwip-js';
