/**
 * Finalize a GitHub release after electron-builder publishes it.
 * electron-builder creates the release as a DRAFT when the git tag does
 * not exist yet. This script creates the tag (if missing) and publishes
 * the draft so the auto-updater can see it.
 */
const https = require('https');

const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
const { version } = require('../package.json');
const tag = `v${version}`;

if (!TOKEN) {
  console.error('FINALIZE_FAIL: GH_TOKEN not set');
  process.exit(1);
}

const OWNER = 'hamzarazadomain3-code';
const REPO = 'pos-releases';

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
})();
