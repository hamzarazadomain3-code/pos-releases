// main — the web entry for the REAL desktop renderer. It installs `window.api`
// (via the bridge) and then mounts the unmodified desktop React app. The desktop
// code in src/renderer/src is never edited: only the `electron` boundary and this
// 3-line entry differ.
import './bridge';
import '../../src/renderer/src/main';
