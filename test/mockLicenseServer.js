/*
Mock license server for local smoke tests.
Run with:  node test/mockLicenseServer.js
It uses only Node's built-in HTTP module – no external dependencies required.
 */
const http = require('http');
const crypto = require('crypto');

const licenses = new Map();

function generateKey(shop) {
  const rand = crypto.randomBytes(4).toString('hex').toUpperCase();
  const key = `${shop.toUpperCase().replace(/\s+/g, '_')}-${rand}`;
  const expires = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
  licenses.set(key, { shop, expires, revoked: false });
  return { key, expires };
}

function parseBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (_) {
        resolve({});
      }
    });
  });
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    if (req.method === 'POST' && req.url === '/api/generate') {
      const { shop } = await parseBody(req);
      if (!shop) return res.end(JSON.stringify({ ok: false, msg: 'shop required' }));
      const result = generateKey(shop);
      return res.end(JSON.stringify({ ok: true, key: result.key, expires: result.expires }));
    }
    if (req.method === 'POST' && req.url === '/api/validate') {
      const { key, shop } = await parseBody(req);
      const rec = licenses.get(key);
      if (!rec) return res.end(JSON.stringify({ ok: false, msg: 'Invalid key' }));
      if (rec.revoked) return res.end(JSON.stringify({ ok: false, msg: 'Revoked' }));
      if (rec.shop !== shop) return res.end(JSON.stringify({ ok: false, msg: 'Shop mismatch' }));
      if (new Date() > new Date(rec.expires)) return res.end(JSON.stringify({ ok: false, msg: 'Expired' }));
      return res.end(JSON.stringify({ ok: true, expires: rec.expires }));
    }
    if (req.method === 'POST' && req.url === '/api/revoke') {
      const { key } = await parseBody(req);
      const rec = licenses.get(key);
      if (rec) rec.revoked = true;
      return res.end(JSON.stringify({ ok: true }));
    }
    if (req.method === 'GET' && req.url === '/api/active') {
      const now = new Date();
      const active = [...licenses.entries()]
        .filter(([k, r]) => !r.revoked && new Date(r.expires) > now)
        .map(([k, r]) => ({ key: k, shop: r.shop, expires: r.expires }));
      return res.end(JSON.stringify(active));
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ ok: false, msg: 'Not found' }));
  } catch (e) {
    res.statusCode = 500;
    res.end(JSON.stringify({ ok: false, msg: e.message }));
  }
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => console.log(`Mock license server listening on ${PORT}`));
