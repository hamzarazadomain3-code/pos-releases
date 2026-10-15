// Vite config for the WEB build of the REAL desktop renderer.
//
// It mirrors the desktop's own vite.config.ts aliases (@shared/@renderer/…) and
// adds exactly one new alias: `electron` -> cloud/web/electron-browser.ts, the
// browser stand-in that makes the unmodified desktop preload install `window.api`.
//
// Output goes to cloud/web-dist/app, which the Cloudflare `[assets]` binding in
// wrangler.toml serves at /app. `base: '/app/'` makes every emitted asset URL
// absolute under that prefix.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..', '..'); // pos-app
const rendererSrc = path.join(appRoot, 'src', 'renderer', 'src');

// The desktop app version, injected the same way the worker bundle injects it so
// `app:get-version` matches the renderer that is actually served.
const appVersion = JSON.parse(readFileSync(path.join(appRoot, 'package.json'), 'utf8')).version;

export default defineConfig({
  root: here,
  base: '/app/',
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(appVersion) },
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: {
      // The one web-specific substitution: a browser `electron`.
      electron: path.join(here, 'electron-browser.ts'),
      // The same aliases the desktop renderer build uses.
      '@shared': path.join(appRoot, 'src', 'shared'),
      '@renderer': rendererSrc,
      '@components': path.join(rendererSrc, 'components'),
      '@hooks': path.join(rendererSrc, 'hooks'),
      '@utils': path.join(rendererSrc, 'utils'),
      '@pages': path.join(rendererSrc, 'pages'),
    },
  },
  build: {
    outDir: path.resolve(here, '..', 'web-dist', 'app'),
    emptyOutDir: true,
    sourcemap: false,
    target: 'es2020',
    chunkSizeWarningLimit: 2000,
    // Mirror the desktop build's chunking EXACTLY (see ../../vite.config.ts).
    // Without these pins rollup regroups the lazy page chunks and can hoist a
    // `const` after a top-level use across a circular import — a runtime TDZ
    // (`Cannot access 'X' before initialization`) that only shows up in a browser.
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom'],
          recharts: ['recharts'],
          xlsx: ['xlsx'],
        },
      },
    },
  },
});
