// bridge — wires `window.api` for the web app by running the UNMODIFIED desktop
// preload (`src/preload/preload.ts`) against the browser `electron` shim. Order
// matters: the shim module loads first, the preload assigns `window.api` as a side
// effect, then we seed the renderer's session marker so App.tsx restores the POS
// straight into the app, and finally honour `?page=<nav>` deep links.
import { seedRendererSession } from './electron-browser';
import { applyRequestedPage } from './requested-page';
import '../../src/preload/preload';

seedRendererSession();
applyRequestedPage();
