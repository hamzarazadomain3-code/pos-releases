// build-web.mjs — builds the WEB version of the real desktop renderer with Vite
// (config: cloud/web/vite.config.mjs) into cloud/web-dist/app. The Cloudflare
// `[assets]` binding in wrangler.toml serves that directory at /app.
//
// Separate from build.mjs on purpose: the worker bundle (esbuild) and the browser
// bundle (Vite + React) are different pipelines with different aliases.
import { build } from 'vite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const configFile = path.join(here, '..', 'web', 'vite.config.mjs');

await build({ configFile });
console.log('[build] web app -> web-dist/app (served at /app)');
