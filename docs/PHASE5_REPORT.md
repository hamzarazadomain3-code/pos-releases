# PHASE 5 REPORT — Rokar POS (the release, the owner checklist, the deploy)

**Run date:** 2026-11-28
**Baseline:** `v2.32.0` (`main` @ `8a4de3d` after Phase 0 → 4)
**Scope:** `E:\antigravty\billing softwere\pos-app` + the release repo
(`hamzarazadomain3-code/pos-releases`) + the marketing site
(`E:\antigravty\rokar-site`)
**Proofs:** `E:\temp\proof\final_*`, `E:\temp\proof\release_v2.33.0.txt`,
`E:\temp\proof\verify_release_v2.33.0.txt`, `E:\temp\proof\*_v2.33.0.*`

---

## 1. Summary

Phase 5 is the gate. The first four phases fixed the app; this phase **proves
the whole tree, writes the owner's checklist, cuts the release and deploys it**.

It has six parts (the sixth one **appeared during the deploy**):

1. **The final battery** — every `test:*` / `check:*` script in `package.json`
   (103 suites) plus the typecheck = **104 suites**, each with its own saved
   output. The verdict uses the suite's own `ALL PASSED` / `[FAIL]` marker as
   well as the exit code, because Electron prints a "Network service crashed"
   banner on stderr and Windows then reports a non-zero exit for a green suite.
2. **The owner checklist** — `docs/OWNER_CHECKLIST.md` (the things no automated
   test can prove, plus the owner decisions), and the stale
   `MANUAL_TEST_CHECKLIST.md` (v1.5.0) replaced with the current v2.33.0 smoke
   test.
3. **The release notes** — the stale `RELEASE_NOTES.md` (v2.15.1) replaced with
   the v2.33.0 notes.
4. **The desktop release** — version `2.33.0`, the NSIS installer + the
   portable build, a published GitHub release with a correct `latest.yml` and
   the version-less `RokarPOS-Setup.exe` alias.
5. **The deploy** — the source pushed to `main`, the Cloudflare Worker (the web
   app) redeployed by the push hook, and the marketing site updated to 2.33.0.
6. **The defect the deploy found** — Phase 0's credential vault imported
   `safeStorage` from 'electron', and the Worker's server shim did not export
   it, so the Worker bundle refused to build and the deploy died (item **5.9**).
   Fixed, and now guarded by a permanent suite (`test:cloudShim`).

**Status: DONE.** The final battery is **104 suites, 104 GREEN, 0 RED**, the
owner checklist is written, **v2.33.0 is published and verified**, the Worker
and the site are live with the new code — and the deploy caught one **real
defect of our own** (the Phase 0 credential vault broke the Worker bundle),
which is now fixed and guarded.

> **The sixth part appeared during the deploy.** The Worker deploy failed
> because Phase 0's `safeStorage` import had no matching export in the
> server shim — a defect the battery could not see, because **no
> suite builds the Worker**. It is item **5.9** below, and
> `npm run test:cloudShim` is now the permanent guard. The lesson is recorded
> in §7.

---

## 2. The final battery

Command: `powershell -File E:\temp\proof\run_final_battery.ps1`
(the script enumerates every `test:*` / `check:*` script in `package.json`,
runs each with a 300 s cap, saves its stdout + stderr, and judges it by both
the exit code and its own PASS / FAIL marker).

**Result: 104 suites, 104 GREEN, 0 RED** — the full table is
`E:\temp\proof\final_summary.txt`; each suite's own output is
`E:\temp\proof\final_<suite>.txt`; the run log is
`E:\temp\proof\final_battery_log.txt`.

| Check | Result |
|---|---|
| `npm run typecheck` | exit 0 (`[forbidden-strings] OK`, both `tsc` projects clean) |
| `npm run test:printPipeline` | **112/112** |
| `npm run test:billingSmoke` | **46/46** |
| `npm run test:ui` | **30/30** |
| `npm run test:keyboard` | **93/93** |
| `npm run test:ipcError` | **38/38** |
| `npm run test:recovery` | **48/48** |
| `npm run test:cloudShim` (the new guard, item 5.9) | **13/13** |
| `npm run check:migrations` | **Integrity check: ok** |

> **The first run said 101 GREEN / 2 RED, and it was the runner that was
> wrong.** The verdict rule used PowerShell's `-match`, which is
> **case-insensitive**, and an unanchored alternation. It therefore read two
> **PASS** lines as failures:
>
> - `test:ipcError` → `[PASS] internal: Error: UNIQUE constraint failed: users.username`
> - `test:recovery` → `[PASS] lockout engages at 5 failures even for the right answer`
>
> Both suites printed their own success markers (`38/38 checks passed` and
> `ALL PASSED: 48/48 checks passed`). The rule is now **strict**: a failure
> must be a line that *starts* with `[FAIL]`, or a `RESULT: FAIL` /
> `FAILED:` / `FAILURES: n>0` / `N passed, M failed` summary line, all **case
> sensitive**; and a suite is GREEN only when its **own** output carries a pass
> marker. The saved outputs were re-judged from the evidence
> (`E:\temp\proof\rejudge_final.ps1`) — nothing was re-run and no product code
> changed — and every one of the **57 lines** in all 103 outputs that contains
> the word "fail" was read by hand: every one is a PASS line describing a
> failure *scenario* ("the unknown customer fails cleanly", "0 failed"), none
> is a failure. The old summary is kept as
> `E:\temp\proof\final_summary_v1_loose_rule.txt` so the change is visible.
>
> **The battery was then run again on the FINAL tree** (after the item 5.9
> fix), with the strict rule already in place: **104 suites, 104 GREEN, 0 RED**
> — the table above is from that run (`final_summary.txt`, dated
> 2026-11-28 07:24:50). The same word-by-word scan was repeated over the new
> 104 outputs (`E:\temp\proof\fail_words_scan_104.txt`): **57 lines mention
> "fail", and 0 of them match a strict failure shape.**

---

## 3. The owner checklist and the manual test

- `docs/OWNER_CHECKLIST.md` — 9 sections: install, first launch, billing,
  stock/batches/expiry, the purchase-order screen, printing, users/security,
  the web app, deploy/release, and the owner decisions that are choices,
  not bugs.
- **`docs/OWNER_CHECKLIST.md` §9 gained a 12th decision** (the web app stores
  a credential as plain text in the cloud database, because a Worker has no
  OS key store). The owner is told plainly, instead of the difference being
  discovered by surprise.
- `MANUAL_TEST_CHECKLIST.md` — **replaced**. It still described v1.5.0 (the
  default `admin/admin123`, the old licence grace, screens that no longer
  exist). The new file is the v2.33.0 short smoke test: install, one sale +
  one return, stock/expiry, a purchase order, printer setup, users/settings,
  and the update check. It points at `docs/OWNER_CHECKLIST.md` for the full
  list instead of keeping a second copy that can drift.
- `RELEASE_NOTES.md` — **replaced**. It still carried v2.15.1 as the newest
  release. The new file is the v2.33.0 notes, grouped by the shop's own
  concerns (the money path, the purchase order, printing, security), with the
  open owner decisions named.

---

## 4. The desktop release

**v2.33.0 is PUBLISHED** (not a draft, not a prerelease).

| What | Value |
|---|---|
| The version bump | `2.32.0` → **2.33.0** (`package.json`; `package-lock.json`'s version field was still `2.21.0` and is now in step) |
| The build | `npm run release` = `npm run build` + electron-builder 24.13.3 (Electron 43.4.0) + `scripts/finalize-release.js`; **exit 0** |
| The tag | `v2.33.0` → `94d3fe2` — the commit the installer was **built** from (already pushed) |
| `RokarPOS-Setup-2.33.0.exe` | 122 054 251 bytes |
| `RokarPOS-Portable-2.33.0.exe` | 121 643 107 bytes |
| `RokarPOS-Setup-2.33.0.exe.blockmap` | 127 850 bytes |
| `latest.yml` | 348 bytes — **rebuilt from the installer's OWN bytes** (sha512 + size), the stale copy deleted first |
| `RokarPOS-Setup.exe` (the version-less alias) | 122 054 251 bytes — sha256 `c5a95f90a8707ecf238d22e3566ae9bc14bc5058af0ea1b120040a7d54a2b9e7`, **byte-identical** to the versioned installer |
| The updater check | `npm run verify:release -- v2.33.0` → **9 passed / 0 failed** (the manifest, the installer's sha512 **byte for byte**, the blockmap, the alias, the CDN feed) |
| The alias check | the first two bytes of `/releases/latest/download/RokarPOS-Setup.exe` are **4D-5A** (`MZ`) — a real PE executable, not an HTML error page |
| The release view | `isDraft: false`, `isPrerelease: false`, `publishedAt: 2026-11-28T01:56:32Z` |

Proofs: `E:\temp\proof\release_v2.33.0.txt` (the whole run),
`E:\temp\proof\verify_release_v2.33.0.txt`,
`E:\temp\proof\release_view_v2.33.0.json`,
`E:\temp\proof\alias_head_v2.33.0.bin`.

> **The tag points at `94d3fe2`, not at the last commit.** The tag must sit on
> the commit the **installer was built from** — otherwise the release's source
> snapshot is a different version from the binary. The only commit after it is
> the Worker-shim fix (5.9), which touches `cloud/` + one test script and is
> **not** part of the installer (`build.files` = `dist/**`, `package.json`,
> `scripts/smoke.js`, migrations, the icon, the fonts).

---

## 5. The deploy

### The source

`git push origin main` → `3461923..94d3fe2` (the whole run: Phase 0 → 4 plus
the release commit), then `94d3fe2..d5b9e0c` (the Worker-shim fix). The
`main` branch was **12 commits ahead** of `origin/main` before this phase; it
is now in step. Proof: `E:\temp\proof\push_main_v2.33.0.txt`,
`push_main_v2.33.0_fix.txt`.

### The Cloudflare Worker (the web app)

**The first deploy FAILED, and it was our own fault.** The Worker bundles the
**real** desktop `src/main/ipc.ts`, so `electron` is aliased to
`cloud/src/shims/electron-server.ts`. Phase 0's credential vault
(`src/main/services/secretVault.ts`) imports `safeStorage` from 'electron' —
and the shim had no such export, so esbuild refused to bundle:

```
../src/main/services/secretVault.ts:1:9: ERROR: No matching export in
"src/shims/electron-server.ts" for import "safeStorage"
DEPLOY FAILED: npm run deploy exited with code 1
```

**The battery could not see it**, because no suite builds the
Worker. The live Worker was not broken — the failed deploy simply left the
**previous** version live — but the web app would have stayed on the old code
forever, silently.

The fix: the shim now exports `safeStorage` (no key store on a Worker: the
credential is stored as plain text, and a value encrypted on the desktop reads
as **empty** instead of leaking) and `powerMonitor` (no power events on a
Worker). The permanent guard is **`npm run test:cloudShim`** (13 checks): it
compares every **value** import the desktop takes from 'electron' with the
shim's exports, and then runs the **real** `cloud/scripts/build.mjs` and
insists the bundle is produced.

| What | Value |
|---|---|
| The fix | `cloud/src/shims/electron-server.ts` (`safeStorage`, `powerMonitor`), `scripts/test_cloudShim.cjs`, `package.json` (`test:cloudShim`) |
| The guard | `npm run test:cloudShim` → **13/13 ALL PASSED** (`E:\temp\proof\p5_cloudShim.txt`) |
| The deploy | `npm run deploy` (build → build:web → fix-workerd → `wrangler deploy`) → **deploy OK** |
| The Worker version id | `29d1d6ec-6e42-4247-b5af-2884f7f861c8` |
| The live URL | `https://rokar-pos.bakery-saas.workers.dev/app` → **200** |
| The live health | `https://rokar-pos.bakery-saas.workers.dev/api/health` → **200** `{"ok":true,"service":"rokar-pos","version":"0.1.0"}` |
| The live bundle | the served `/app/assets/index-*.js` **carries 2.33.0** and the Phase 4 printing work |

Proofs: `E:\temp\proof\cloud_worker_deploy_v2.33.0.txt` (the whole deploy log).

### The marketing site

| What | Value |
|---|---|
| The change | `src/content.json` — `site.latestVersion` → **2.33.0** + a new changelog entry (13 notes, in the site's own voice) |
| The local build | `npm run typecheck` / `verify:content` / `verify:industries` / `verify:contrast` / `verify:ssr` / `verify:fonts` / `build` / `verify:bundle` → **every one exit 0** |
| The claim check | `verify:claims` → **only the 2 pre-existing 2.25.0 failures** (the "seconds" wording in the old entry). The new 2.33.0 entry passes. (With `ROKAR_APP_DIR` set, so the perpetual-licence claim is cross-checked against the real code.) |
| The push | `1073d3a..73b1793` on `rokar-pos-site` |
| The live site | `https://rokarpos.co.uk` → **200**, serving **the exact local bundle** `index-BUppLATP.js`, and that bundle carries **2.33.0** + the new changelog title |

Proofs: `E:\temp\proof\site_build_2.33.0.txt`,
`E:\temp\proof\site_claims_2.33.0.txt`,
`E:\temp\proof\site_typecheck_2.33.0.txt`, and the per-step files.

---

## 6. The files Phase 5 touched

Everything Phase 5 changed, in one place. **The owner's files were not
touched**: `scripts/seed_demo.js` (modified) and the five stray untracked
scripts were left exactly as they were.

| File | What changed | Commit |
|---|---|---|
| `package.json` | the version → **2.33.0** + the new `test:cloudShim` script | `94d3fe2`, `d5b9e0c` |
| `package-lock.json` | the version field → **2.33.0** (it was still `2.21.0`) | `94d3fe2` |
| `AGENTS.md` | the version line + a new section: **the Worker shim must keep up with the desktop's electron imports** | `94d3fe2`, `d5b9e0c` |
| `CHANGELOG.md` | the whole Phase 5 block (5.1 → 5.9) | `94d3fe2`, `d5b9e0c` |
| `PROGRESS.md` | the Phase 5 ledger (9 rows, with the real hashes) | `94d3fe2`, `d5b9e0c`, the phase-close commit |
| `docs/PLAN.md` | §16 (the scope) + §17 (the status matrix, 5.1 → 5.9) | `94d3fe2`, `d5b9e0c` |
| `docs/DECISIONS.md` | **D44** (a suite's verdict comes from its own output) + **D45** (the Worker shim must export every value import) | the phase-close commit |
| `docs/PHASE5_REPORT.md` | this report (new) | the phase-close commit |
| `docs/OWNER_CHECKLIST.md` | the v2.33.0 header, the web-app secret note in §8, and a **12th owner decision** | the phase-close commit |
| `MANUAL_TEST_CHECKLIST.md` | **replaced** (it described v1.5.0) | `94d3fe2` |
| `RELEASE_NOTES.md` | **replaced** (it carried v2.15.1) + the web-app secret note | `94d3fe2`, the phase-close commit |
| `cloud/src/shims/electron-server.ts` | the `safeStorage` + `powerMonitor` stubs (item 5.9) | `d5b9e0c` |
| `scripts/test_cloudShim.cjs` | the permanent guard for the Worker build (new) | `d5b9e0c` |
| `E:\antigravty\rokar-site\src\content.json` | `latestVersion` → 2.33.0 + the new changelog entry (the **site** repo) | the site commit `73b1793` |

---

## 7. Risks and honest gaps

1. **The final battery is a Windows/Electron run.** A green battery proves the
   code paths and the real renderer on this machine; it does **not** prove a
   physical printer, a cash drawer, a scanner or a real shop's data. Those are
   the owner checklist's job, and the report says so.
2. **Electron's stderr banner can make a green suite exit non-zero.** The
   runner records `GREEN(exit-quirk)` when the suite's own marker says PASS but
   Windows reports a non-zero exit. A suite is never called green on the exit
   code alone.
3. **The release is signed by nothing.** The installer is not code-signed (the
   build deliberately uses the vendored `rcedit` for the icon); Windows
   SmartScreen may warn on first download. That is unchanged from v2.32.0 and
   is a cost decision, not a regression.
4. **The open owner decisions remain open** (see `docs/OWNER_CHECKLIST.md` §9):
   credential rotation, the strict password policy, the default receipt
   template, the currency policy across every document, the Receipt Designer's
   scope, the legacy template dropdown, per-branch stock, the purchases
   permission flag, the import unit policy, and the WhatsApp receipt format.
5. **The site's `verify:claims` still reports its two pre-existing 2.25.0
   failures** (if they are still present); they are content-history findings,
   not caused by this release, and are named rather than hidden.
6. **The test battery did NOT build the Worker — and that is how a real
   defect shipped to the deploy.** Phase 0's credential vault imported
   `safeStorage` from 'electron'; the Worker bundles the real desktop code
   with 'electron' aliased to the server shim, and the shim had no
   `safeStorage` export, so the bundle refused to build and the deploy died.
   The suite is now there (`test:cloudShim`), but the general lesson stands:
   **a suite that does not build the thing you deploy cannot protect it.**
   The next deploy-shaped gap is the **web build** (`cloud/scripts/build-web.mjs`),
   which the same guard now exercises end to end.
7. **The release/deploy is outward-facing, and it happened.** The owner asked
   for the full run; the local `main` was 12 commits ahead of `origin/main`
   before this phase, so the push is the point where the owner's review window
   closed. Every published hash, version id and asset size is recorded above
   and in `PROGRESS.md`, so a rollback is possible.
8. **The window title of the receipt preview is still English**, and the rest
   of the Settings page and the whole Receipt Designer screen are still
   English — Phase 4's open items, unchanged by this release (they are in
   `docs/OWNER_CHECKLIST.md` §5 and §9).

---

## 8. Next

- The owner installs v2.33.0 on a **test machine** first and walks
  `docs/OWNER_CHECKLIST.md` (the printer section first).
- The owner answers the 12 decisions in `docs/OWNER_CHECKLIST.md` §9.
- Any future release follows the same gate: the full battery, the owner
  checklist, `npm run release`, `npm run verify:release -- vX.Y.Z`, the alias
  `MZ` check, then the Worker/site verification.
