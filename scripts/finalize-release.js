/**
 * Finalize a GitHub release after electron-builder publishes it.
 * electron-builder creates the release as a DRAFT when the git tag does
 * not exist yet. This script creates the tag (if missing) and publishes
 * the draft so the auto-updater can see it.
 */
const https = require('https');
const fs = require('fs');
const path = require('path');

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
  const stat = fs.statSync(filePath);
  const boundary = `----rokar${Date.now()}`;
  const head = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="name"\r\n\r\n${assetName}\r\n` +
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="data"; filename="${path.basename(filePath)}"\r\n` +
      `Content-Type: application/octet-stream\r\n\r\n`,
    'utf8'
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');

  const req = https.request(
    {
      hostname: 'uploads.github.com',
      path: `/repos/${OWNER}/${REPO}/releases/${releaseId}/assets?name=${encodeURIComponent(assetName)}`,
      method: 'POST',
      headers: {
        Authorization: `token ${TOKEN}`,
        'User-Agent': 'pos-app-release',
        Accept: 'application/vnd.github+json',
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': head.length + stat.size + tail.length,
      },
    },
    (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) console.log(`Stable asset uploaded: ${assetName}`);
        else console.log(`Stable asset upload skipped (HTTP ${res.statusCode}): ${data.slice(0, 160)}`);
      });
    }
  );
  req.on('error', (e) => console.log(`Stable asset upload error: ${e.message}`));
  req.write(head);
  fs.createReadStream(filePath).pipe(req, { end: false });
  req.write(tail);
  req.end();
  return new Promise((resolve) => setTimeout(resolve, 1500));
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

  // 2. Create the git tag if it doesn't exist
  const tagCheck = await api('GET', `/repos/${OWNER}/${REPO}/git/ref/tags/${tag}`);
  if (tagCheck.status === 404) {
    const head = await api('GET', `/repos/${OWNER}/${REPO}/commits/main`);
    const sha = head.body.sha;
    const created = await api('POST', `/repos/${OWNER}/${REPO}/git/refs`, {
      ref: `refs/tags/${tag}`,
      sha,
    });
    if (created.status !== 201) {
      console.error(`FINALIZE_FAIL: could not create tag ${tag}: ${JSON.stringify(created.body)}`);
      process.exit(1);
    }
    console.log(`Tag ${tag} created.`);
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
  const assets = (published.body.assets || []).map((a) => a.name);
  if (assets.includes(STABLE_ASSET)) {
    console.log(`Stable asset already present: ${STABLE_ASSET}`);
  } else {
    const outDir = (build && build.directories && build.directories.output) || 'dist_release';
    const installer = path.join(__dirname, '..', outDir, `RokarPOS-Setup-${version}.exe`);
    if (!fs.existsSync(installer)) {
      console.log(`WARN: installer not found at ${installer} -- ${STABLE_ASSET} not uploaded.`);
      console.log('      The website download button will keep serving the previous release.');
    } else {
      await uploadAsset(release.id, installer, STABLE_ASSET);
    }
  }
})();
