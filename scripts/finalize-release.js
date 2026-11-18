/**
 * Finalize a GitHub release after electron-builder publishes it.
 * electron-builder creates the release as a DRAFT when the git tag does
 * not exist yet. This script creates the tag (if missing) and publishes
 * the draft so the auto-updater can see it.
 */
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
const { version } = require('../package.json');
const { build } = require('../package.json');
const tag = `v${version}`;

/**
 * Version-less asset name the marketing site downloads from.
 *
 * The site must not hard-code a version in its download link, otherwise every
 * release would require a site edit and the page would silently keep serving an
 * old installer. GitHub's `/releases/latest/download/<name>` always redirects to
 * the newest published release, but `<name>` has to match the asset EXACTLY --
 * so each release also carries a copy of the installer under this stable name.
 */
const STABLE_ASSET = 'RokarPOS-Setup.exe';

if (!TOKEN) {
  console.error('FINALIZE_FAIL: GH_TOKEN not set');
  process.exit(1);
}

const OWNER = 'hamzarazadomain3-code';
const REPO = 'pos-releases';

function uploadAsset(releaseId, filePath, assetName) {
  // GitHub's "upload a release asset" endpoint takes the RAW file bytes as the
  // request body (with the name in the query string and Content-Type:
  // application/octet-stream). It is NOT a multipart/form-data upload: sending
  // multipart makes GitHub store the entire encoded body as the asset, so the
  // installer is 274 bytes too big and starts with "--<boundary>" instead of
  // "MZ" — i.e. a corrupt download for every client.
  return new Promise((resolve) => {
    const stat = fs.statSync(filePath);
    const req = https.request(
      {
        hostname: 'uploads.github.com',
        path: `/repos/${OWNER}/${REPO}/releases/${releaseId}/assets?name=${encodeURIComponent(assetName)}`,
        method: 'POST',
        headers: {
          Authorization: `token ${TOKEN}`,
          'User-Agent': 'pos-app-release',
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/octet-stream',
          'Content-Length': stat.size,
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) console.log(`Stable asset uploaded: ${assetName}`);
          else console.log(`Stable asset upload skipped (HTTP ${res.statusCode}): ${data.slice(0, 160)}`);
          resolve();
        });
      }
    );
    req.on('error', (e) => {
      console.log(`Stable asset upload error: ${e.message}`);
      resolve();
    });

    const file = fs.createReadStream(filePath);
    file.on('error', (e) => {
      console.log(`Stable asset read error: ${e.message}`);
      req.destroy();
      resolve();
    });
    // Pipe with end:true — Node calls req.end() when the file stream finishes.
    file.pipe(req);
  });
}

/**
 * Build the update manifest from the installer's ACTUAL bytes.
 *
 * electron-builder writes `latest.yml` while it packages, but the installer
 * can be rebuilt afterwards (NSIS embeds a build timestamp, so the bytes and
 * the sha512 change). A manifest that describes the PREVIOUS build makes every
 * client fail the checksum check, and a manifest that was never uploaded makes
 * them fail with "Cannot find channel latest.yml update info: 404". Deriving
 * it here from the file we are actually shipping removes both failure modes.
 */
function buildManifest(installerPath) {
  const sha512 = crypto.createHash('sha512').update(fs.readFileSync(installerPath)).digest('base64');
  const size = fs.statSync(installerPath).size;
  const releaseDate = new Date().toISOString();
  return (
    `version: ${version}\n` +
    `files:\n` +
    `  - url: RokarPOS-Setup-${version}.exe\n` +
    `    sha512: ${sha512}\n` +
    `    size: ${size}\n` +
    `path: RokarPOS-Setup-${version}.exe\n` +
    `sha512: ${sha512}\n` +
    `releaseDate: '${releaseDate}'\n`
  );
}

/** Remove an asset so a fresh copy can be uploaded in its place. */
function deleteAsset(assetId) {
  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: 'api.github.com',
        path: `/repos/${OWNER}/${REPO}/releases/assets/${assetId}`,
        method: 'DELETE',
        headers: {
          Authorization: `token ${TOKEN}`,
          'User-Agent': 'pos-app-release',
          Accept: 'application/vnd.github+json',
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          if (res.statusCode === 204) console.log('Deleted the stale latest.yml asset.');
          else console.log(`Delete returned HTTP ${res.statusCode} (continuing).`);
          resolve();
        });
      }
    );
    req.on('error', () => resolve());
    req.end();
  });
}

function api(method, path, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'api.github.com',
        path,
        method,
        headers: {
          Authorization: `token ${TOKEN}`,
          'User-Agent': 'pos-app-release',
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null });
          } catch {
            resolve({ status: res.statusCode, body: data });
          }
        });
      }
    );
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

(async () => {
  // 1. Find the draft release for this version
  const list = await api('GET', `/repos/${OWNER}/${REPO}/releases`);
  const release = (list.body || []).find((r) => r.tag_name === tag || (r.draft && r.name === `v${version}`));
  if (!release) {
    console.error(`FINALIZE_FAIL: no draft release found for ${tag}`);
    process.exit(1);
  }

  // 2. Create the git tag if it doesn't exist.
  //
  //    The tag MUST point at the commit that was BUILT. It used to point at
  //    `main`'s head, which published a release whose source snapshot was a
  //    completely different version (on 2026-11-18 the v2.29.0 tag landed on
  //    the 2.23.0 commit because `main` was that old). The built commit is
  //    the local HEAD — this script runs right after the build, so nothing has
  //    committed in between — and it is only used when the remote actually has
  //    it (a branch that was never pushed falls back to `main`, with a
  //    warning).
  const tagCheck = await api('GET', `/repos/${OWNER}/${REPO}/git/ref/tags/${tag}`);
  if (tagCheck.status === 404) {
    let sha = null;
    let localSha = null;
    try {
      localSha = String(
        execSync('git rev-parse HEAD', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }) || ''
      ).trim();
    } catch {
      localSha = null;
    }
    if (localSha) {
      const built = await api('GET', `/repos/${OWNER}/${REPO}/commits/${localSha}`);
      if (built.status === 200) sha = localSha;
    }
    if (!sha) {
      const head = await api('GET', `/repos/${OWNER}/${REPO}/commits/main`);
      sha = head.body.sha;
      console.warn(
        `WARN: the built commit is not on the remote — the tag falls back to main (${sha}).`
      );
    }
    const created = await api('POST', `/repos/${OWNER}/${REPO}/git/refs`, {
      ref: `refs/tags/${tag}`,
      sha,
    });
    if (created.status !== 201) {
      console.error(`FINALIZE_FAIL: could not create tag ${tag}: ${JSON.stringify(created.body)}`);
      process.exit(1);
    }
    console.log(`Tag ${tag} created at ${sha}.`);
  } else if (tagCheck.status === 200) {
    // The tag exists. If it points somewhere else than the code that was
    // built, say so loudly — but never move a published tag on its own.
    let localSha = null;
    try {
      localSha = String(
        execSync('git rev-parse HEAD', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }) || ''
      ).trim();
    } catch {
      localSha = null;
    }
    const tagged = tagCheck.body && tagCheck.body.object ? tagCheck.body.object.sha : '';
    if (localSha && tagged && tagged !== localSha) {
      console.warn(
        `WARN: the tag ${tag} points at ${tagged} but this build ran at ${localSha}. ` +
          'A published tag is never moved automatically — check it before shipping.'
      );
    }
  }

  // 3. Publish the draft release
  const published = await api('PATCH', `/repos/${OWNER}/${REPO}/releases/${release.id}`, { draft: false });
  if (published.status !== 200) {
    console.error(`FINALIZE_FAIL: could not publish release: ${JSON.stringify(published.body)}`);
    process.exit(1);
  }
  console.log(`Release ${tag} published: ${published.body.html_url}`);

  // 4. Mirror the installer under a version-less name so the website's download
  //    button can point at /releases/latest/download/... forever. Without this the
  //    site would serve the previous version after every release.
  const outDir = (build && build.directories && build.directories.output) || 'dist_release';
  const installer = path.join(__dirname, '..', outDir, `RokarPOS-Setup-${version}.exe`);

  let assets = (published.body.assets || []).map((a) => a.name);
  if (assets.includes(STABLE_ASSET)) {
    console.log(`Stable asset already present: ${STABLE_ASSET}`);
  } else if (!fs.existsSync(installer)) {
    console.log(`WARN: installer not found at ${installer} -- ${STABLE_ASSET} not uploaded.`);
    console.log('      The website download button will keep serving the previous release.');
  } else {
    await uploadAsset(release.id, installer, STABLE_ASSET);
  }

  // 5. ALWAYS (re)write latest.yml from the installer's ACTUAL bytes.
  //
  //    Two ways a release ships without a usable manifest, both of which break
  //    EVERY client ("Cannot find channel latest.yml update info: 404" or a
  //    checksum error):
  //      a) electron-builder's publish step was interrupted before it uploaded
  //         latest.yml;
  //      b) the installer was rebuilt afterwards (NSIS embeds a build timestamp,
  //         so the bytes and the sha512 change) while the local latest.yml kept
  //         describing the PREVIOUS build.
  //    Writing the manifest here -- from the file we are about to ship -- makes
  //    both impossible.
  if (fs.existsSync(installer)) {
    const manifest = buildManifest(installer);
    const manifestPath = path.join(__dirname, '..', outDir, 'latest.yml');
    fs.writeFileSync(manifestPath, manifest);
    console.log('latest.yml written from the installer bytes:');
    console.log(manifest.trim());
    // Replace any stale copy already on the release.
    const existing = (published.body.assets || []).find((a) => a.name === 'latest.yml');
    if (existing) {
      await deleteAsset(existing.id);
    }
    await uploadAsset(release.id, manifestPath, 'latest.yml');
  } else {
    console.log('WARN: installer not found -- latest.yml NOT regenerated.');
  }

  // 6. Verify the release is complete. A half-published release is worse than
  //    no release at all: clients would download a broken update.
  const final = await api('GET', `/repos/${OWNER}/${REPO}/releases/tags/${tag}`);
  const names = (final.body.assets || []).map((a) => a.name);
  const required = [
    'latest.yml',
    `RokarPOS-Setup-${version}.exe`,
    `RokarPOS-Setup-${version}.exe.blockmap`,
    STABLE_ASSET,
  ];
  const missing = required.filter((n) => !names.includes(n));
  console.log(`Release assets: ${names.join(', ')}`);
  if (missing.length) {
    console.error(`FINALIZE_FAIL: release ${tag} is missing: ${missing.join(', ')}`);
    console.error('              clients would fail to update -- fix before shipping.');
    process.exit(1);
  }
  console.log(`OK: release ${tag} has every asset the updater needs.`);
})();
