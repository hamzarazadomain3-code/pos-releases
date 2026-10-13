#!/usr/bin/env node
/**
 * Image-upload helper test (pure Node, no Electron).
 *
 * `src/shared/imageMath.ts` gates every "upload an image from this PC" control
 * (Label Studio image element, Inventory product photo, Settings shop logo,
 * Admin wallpaper). It must reject non-images and oversized files *before* the
 * renderer reads them, and it must downscale predictably so a shop photo never
 * bloats a SQLite row or the localStorage quota Label Studio templates live in.
 *
 * This suite covers the pure maths/validation; the decode+canvas path lives in
 * `src/renderer/src/utils/imageUpload.ts` and is exercised by the app itself.
 *
 * Run: npm run test:imageupload   (builds dist/shared first)
 */
const {
  MAX_UPLOAD_BYTES,
  ALLOWED_IMAGE_TYPES,
  isAllowedImageType,
  validateImageUpload,
  fitWithin,
  formatBytes,
} = require('../dist/shared/imageMath.js');

let checks = 0;
let failures = 0;
function check(name, cond, detail) {
  checks++;
  if (!cond) failures++;
  console.log(`  [${cond ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
}

console.log('=== Image upload helpers ===');

// ── allowed types ───────────────────────────────────────────────────────────
console.log('\n-- allowed types --');
check('png / jpeg / jpg / webp / gif are allowed',
  ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif'].every(isAllowedImageType));
check('type match is case-insensitive', isAllowedImageType('IMAGE/PNG'));
check('svg is rejected (script payloads)', !isAllowedImageType('image/svg+xml'));
check('empty type is rejected by isAllowedImageType', !isAllowedImageType(''));
check('ALLOWED_IMAGE_TYPES contains no svg', !ALLOWED_IMAGE_TYPES.includes('image/svg+xml'));

// ── validation ──────────────────────────────────────────────────────────────
console.log('\n-- validation --');
check('a normal png passes', validateImageUpload({ type: 'image/png', size: 50_000 }).ok);
check('an unknown-but-nonempty type fails with a reason',
  (() => { const r = validateImageUpload({ type: 'application/pdf', size: 10 }); return !r.ok && /Unsupported/.test(r.reason); })());
check('an empty type is allowed through to the decoder',
  validateImageUpload({ type: '', size: 10 }).ok);
check('a file over the default ceiling fails',
  (() => { const r = validateImageUpload({ type: 'image/png', size: MAX_UPLOAD_BYTES + 1 }); return !r.ok && /too large/.test(r.reason); })());
check('a file exactly at the ceiling passes',
  validateImageUpload({ type: 'image/png', size: MAX_UPLOAD_BYTES }).ok);
check('a custom ceiling is honoured',
  (() => { const r = validateImageUpload({ type: 'image/png', size: 6 * 1024 * 1024 }, 5 * 1024 * 1024); return !r.ok; })());
check('a missing size does not fail the check',
  validateImageUpload({ type: 'image/png' }).ok);

// ── fitWithin ───────────────────────────────────────────────────────────────
console.log('\n-- fitWithin --');
const same = fitWithin(100, 80, 1024);
check('an already-small image is unchanged', same.width === 100 && same.height === 80);
const landscape = fitWithin(2000, 1000, 800);
check('landscape scales the longest side to maxDim', landscape.width === 800 && landscape.height === 400,
  `${landscape.width}x${landscape.height}`);
const portrait = fitWithin(1000, 2000, 800);
check('portrait scales the longest side to maxDim', portrait.width === 400 && portrait.height === 800,
  `${portrait.width}x${portrait.height}`);
const square = fitWithin(4096, 4096, 512);
check('square scales to maxDim on both sides', square.width === 512 && square.height === 512);
const edge = fitWithin(1, 5000, 100);
check('a 1px dimension never collapses to zero', edge.width >= 1 && edge.height === 100,
  `${edge.width}x${edge.height}`);
const garbage = fitWithin(NaN, 0, 0);
check('garbage dimensions fall back to 1x1 with a floor of 1', garbage.width >= 1 && garbage.height >= 1,
  `${garbage.width}x${garbage.height}`);
check('an already-max image is not enlarged', fitWithin(800, 600, 800).width === 800);

// ── formatBytes ─────────────────────────────────────────────────────────────
console.log('\n-- formatBytes --');
check('bytes under 1KB are labelled B', formatBytes(512) === '512 B', formatBytes(512));
check('kilobytes are labelled KB', formatBytes(2048) === '2.0 KB', formatBytes(2048));
check('megabytes are labelled MB', formatBytes(5 * 1024 * 1024) === '5.0 MB', formatBytes(5 * 1024 * 1024));
check('zero / negative / NaN are 0 B',
  formatBytes(0) === '0 B' && formatBytes(-1) === '0 B' && formatBytes(NaN) === '0 B');

console.log(`\n${failures ? 'FAILED' : 'ALL PASSED'}: ${checks - failures}/${checks} checks`);
process.exit(failures ? 1 : 0);
