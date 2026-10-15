// Rokar POS — web dashboard.
// A dependency-free single-page app served by the same worker that hosts the
// JSON API. Every screen talks to /api/rpc channels which run the REAL desktop
// services, so everything shown is genuine data — no mocks, no fabricated
// claims. Trial messaging stays neutral; activation is owner-only.

(() => {
  'use strict';

  const appEl = document.getElementById('app');
  const SESSION_KEY = 'rokar_web_session';

  // ---------- helpers ----------

  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const fmtMoney = (n, cur) => `${cur || 'Rs'} ${Number(n || 0).toFixed(2)}`;
  const fmtDate = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso);
    return isNaN(d) ? String(iso) : d.toLocaleString();
  };
  const fmtDay = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso);
    return isNaN(d) ? String(iso) : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  };
  const daysLeft = (iso) => {
    if (!iso) return null;
    const ms = new Date(iso).getTime() - Date.now();
    return Math.ceil(ms / (24 * 60 * 60 * 1000));
  };

  const session = {
    get() {
      try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; }
    },
    set(s) { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); },
    clear() { localStorage.removeItem(SESSION_KEY); },
  };

  async function api(pathname, { method = 'GET', body, token } = {}) {
    const headers = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (token) headers.authorization = 'Bearer ' + token;
    const res = await fetch(pathname, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try { data = await res.json(); } catch { /* non-JSON body */ }
    return { status: res.status, data };
  }

  async function rpc(channel, args = []) {
    const s = session.get();
    if (!s || !s.token) throw new Error('Not signed in');
    const { status, data } = await api('/api/rpc', { method: 'POST', body: { channel, args }, token: s.token });
    if (status === 402 && data && data.error === 'trial_expired') {
      const e = new Error('trial_expired');
      e.trialExpired = true;
      throw e;
    }
    if (!data || !data.ok) throw new Error((data && data.error) || `Request failed (${status})`);
    return data.data;
  }

  // view pipeline: setView() replaces the DOM, wire() re-binds the current page.
  let currentView = null;
  function setView(html) {
    appEl.innerHTML = html;
    currentView = html;
  }
  function banner(kind, text) {
    return `<div class="banner ${kind}"><div class="grow">${text}</div></div>`;
  }

  // ---------- landing / auth ----------

  function renderAuthShell(title, tagline, bodyHtml) {
    setView(`
      <div class="auth-wrap">
        <div class="auth-card">
          <div class="brand"><span class="logo">R</span> Rokar POS</div>
          <p class="tagline">${tagline}</p>
          <div id="auth-alert"></div>
          ${bodyHtml}
        </div>
      </div>`);
  }

  function renderAuth(type) {
    if (type === 'signup') {
      renderAuthShell('Create your shop', 'New shops start on a free 7-day trial. Your shop data is private to you.',
        `
        <form id="auth-form">
          <div class="field"><label>Shop name</label><input name="shopName" required placeholder="e.g. Cafe Roast" autocomplete="off" /></div>
          <div class="field"><label>Owner username</label><input name="username" required placeholder="owner" autocomplete="username" /></div>
          <div class="field"><label>Password</label><input name="password" type="password" required autocomplete="new-password" /></div>
          <div class="field"><label>Confirm password</label><input name="confirm" type="password" required autocomplete="new-password" /></div>
          <button class="btn block" type="submit">Create my shop</button>
        </form>
        <div class="switch">Already have a shop? <a href="#/login">Sign in</a></div>`);
      wireAuth('signup');
    } else {
      renderAuthShell('Sign in', 'Sign in to your Rokar POS shop.',
        `
        <form id="auth-form">
          <div class="field"><label>Shop</label><input name="shop" required placeholder="shop name or slug" autocomplete="username" /></div>
          <div class="field"><label>Username</label><input name="username" required placeholder="owner" autocomplete="username" /></div>
          <div class="field"><label>Password</label><input name="password" type="password" required autocomplete="current-password" /></div>
          <button class="btn block" type="submit">Sign in</button>
        </form>
        <div class="switch">New shop? <a href="#/signup">Create one</a></div>`);
      wireAuth('login');
    }
  }

  function showAuthAlert(htmlOrText, kind = 'err') {
    const box = document.getElementById('auth-alert');
    if (box) box.innerHTML = `<div class="alert ${kind}">${htmlOrText}</div>`;
  }

  function wireAuth(type) {
    const form = document.getElementById('auth-form');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const submitBtn = form.querySelector('button[type=submit]');
      submitBtn.disabled = true;
      showAuthAlert('Signing in…', 'ok');
      try {
        let res;
        if (type === 'signup') {
          const p = String(fd.get('password') || '');
          if (String(fd.get('confirm')) !== p) throw new Error('Passwords do not match');
          res = await api('/api/signup', { method: 'POST', body: { shopName: fd.get('shopName'), username: fd.get('username'), password: p } });
          if (!res.data || !res.data.ok) throw new Error((res.data && res.data.error) || 'Signup failed');
        } else {
          res = await api('/api/login', { method: 'POST', body: { shop: fd.get('shop'), username: fd.get('username'), password: fd.get('password') } });
          if (!res.data || !res.data.ok) throw new Error((res.data && res.data.error) || 'Sign in failed');
        }
        const d = res.data;
        const s = {
          token: d.token,
          user: d.user || null,
          shop: d.shop || {},
        };
        session.set(s);
        location.hash = '#/app';
      } catch (err) {
        showAuthAlert(esc(err.message));
        submitBtn.disabled = false;
      }
    });
  }

  function renderLanding() {
    const s = session.get();
    if (s && s.token) {
      location.hash = '#/app';
      return;
    }
    setView(`
      <div class="auth-wrap">
        <div class="auth-card" style="max-width:460px;text-align:center">
          <div class="brand" style="justify-content:center"><span class="logo">R</span> Rokar POS</div>
          <p class="tagline">Web-based point of sale for your shop — inventory, users, activity and settings, right in the browser.</p>
          <div class="row" style="margin-top:1.2rem">
            <a class="btn block" href="#/signup">Create your shop</a>
          </div>
          <div style="margin-top:.6rem"><a class="btn ghost block" href="#/login">Sign in</a></div>
          <p class="small muted" style="margin-top:1.4rem">New shops start on a free 7-day trial.<br />This is a live workspace — everything you see is your shop's real data.</p>
        </div>
      </div>`);
  }

  // ---------- dashboard ----------

  const TABS = [
    ['overview', 'Overview'],
    ['inventory', 'Inventory'],
    ['users', 'Users'],
    ['activity', 'Activity'],
    ['settings', 'Settings'],
  ];

  function renderDashboard(tab) {
    const s = session.get();
    if (!s || !s.token) { location.hash = '#/login'; return; }
    const plan = (s.shop && s.shop.plan) || 'trial';
    const endsAt = s.shop && s.shop.trial_ends_at;
    const left = daysLeft(endsAt);
    const role = (s.user && s.user.role) || '';
    const cur = (s.settings && s.settings.currency) || 'Rs';

    let bannerHtml = '';
    if (plan === 'trial') {
      const when = left !== null && left >= 0 ? `${left} day${left === 1 ? '' : 's'} left (until ${fmtDay(endsAt)})` : `until ${fmtDay(endsAt)}`;
      const act = role === 'owner'
        ? `<button class="btn" id="btn-activate" style="padding:.32rem .7rem;font-size:.85rem">Activate account</button>`
        : `<span class="small muted">ask the shop owner to activate</span>`;
      bannerHtml = banner('warn', `<strong>Trial:</strong> free trial, ${when}.&nbsp; ${act}`);
    }

    setView(`
      <div class="topbar">
        <div class="brand"><span class="logo">R</span> <span class="shop-chip">${esc(s.shop.name || s.shop.slug || 'Rokar POS')}</span>
          <span class="plan-chip ${plan === 'active' ? 'active' : 'trial'}">${plan === 'active' ? 'Active' : 'Trial'}</span>
        </div>
        <div class="grow"></div>
        <div class="user-chip">
          <span>${esc(s.user.username || '')}</span>
          <span class="role">${esc(role)}</span>
          <button class="btn" id="btn-open-pos" style="padding:.28rem .7rem;font-size:.82rem">Open POS</button>
          <button class="btn ghost" id="btn-signout" style="padding:.28rem .6rem;font-size:.82rem">Sign out</button>
        </div>
      </div>
      ${bannerHtml}
      ${plan === 'trial' && left !== null && left < 0 ? banner('danger', 'Your trial period has ended. You can still sign in — ask the shop owner to activate the account.') : ''}
      <nav class="tabs">
        ${TABS.map(([id, label]) => `<button data-tab="${id}" class="${tab === id ? 'active' : ''}">${label}</button>`).join('')}
      </nav>
      <div class="content" id="tab">
        <div class="card"><div class="spin" style="margin:.4rem"></div> Loading…</div>
      </div>
    `);

    document.getElementById('btn-signout').addEventListener('click', () => {
      session.clear();
      location.hash = '#/';
    });
    // The full desktop app is the web build served under /app; opening it with the
    // shop slug lets the renderer's sign-in know which shop this is, and `page=`
    // deep-links straight to the shop Dashboard so a fresh account sees an overview
    // rather than the empty Billing screen (which needs an open shift).
    const openPos = document.getElementById('btn-open-pos');
    if (openPos) openPos.addEventListener('click', () => {
      location.href = '/app/?shop=' + encodeURIComponent((s.shop && s.shop.slug) || '') + '&page=dashboard';
    });
    const act = document.getElementById('btn-activate');
    if (act) act.addEventListener('click', activateAccount);
    document.querySelectorAll('.tabs button').forEach((b) =>
      b.addEventListener('click', () => { location.hash = '#/app/' + b.dataset.tab; }));

    loadTab(tab, { cur });
  }

  async function loadTab(tab, opts = {}) {
    const box = document.getElementById('tab');
    const s = session.get();
    const cur = (opts && opts.cur) || (s && s.settings && s.settings.currency) || 'Rs';
    const render = {
      overview: (data) => renderOverview(box, data, cur),
      inventory: (data) => renderInventory(box, data, cur),
      users: (data) => renderUsers(box, data),
      activity: (data) => renderActivity(box, data),
      settings: (data) => renderSettings(box, data, cur),
    }[tab];
    try {
      if (tab === 'overview') {
        const [settingsData, me, products] = await Promise.all([
          rpc('settings:getAll', []),
          rpc('auth:currentUser', []),
          rpc('inventory:list', []),
        ]);
        const s2 = session.get();
        s2.settings = settingsData;
        session.set(s2);
        render({ settings: settingsData, me, productCount: (products || []).length });
      } else if (tab === 'inventory') {
        render(await rpc('inventory:list', []));
      } else if (tab === 'users') {
        const [users, me] = await Promise.all([rpc('users:list', []), rpc('auth:currentUser', [])]);
        render({ users, me });
      } else if (tab === 'activity') {
        render(await rpc('activity:list', [50]));
      } else if (tab === 'settings') {
        render(await rpc('settings:getAll', []));
      }
    } catch (err) {
      if (err && err.trialExpired) {
        box.innerHTML = `<div class="alert err">Your trial period has ended — the account owner can activate it from the Overview tab.</div>
          <div class="card"><h2>Overview</h2><p class="hint">Load again to refresh.</p></div>`;
        const again = document.createElement('button');
        again.className = 'btn';
        again.textContent = 'Refresh';
        again.onclick = () => loadTab(tab, opts);
        box.appendChild(again);
      } else {
        box.innerHTML = `<div class="alert err">${esc((err && err.message) || 'Something went wrong')}</div>`;
      }
    }
  }

  function renderOverview(box, data, cur) {
    const s = session.get();
    const st = data.settings || {};
    const me = data.me;
    const plan = (s.shop && s.shop.plan) || 'trial';
    box.innerHTML = `
      <div class="grid">
        <div class="stat"><div class="k">Shop</div><div class="v">${esc(st.shop_name || s.shop.name || s.shop.slug || '—')}</div></div>
        <div class="stat"><div class="k">Plan</div><div class="v">${plan === 'active' ? 'Active' : 'Trial'}</div></div>
        <div class="stat"><div class="k">Signed in as</div><div class="v">${esc((me && me.username) || '—')}</div></div>
        <div class="stat"><div class="k">Products</div><div class="v">${Number(data.productCount || 0)}</div></div>
      </div>
      <div class="card">
        <h2>Shop details</h2>
        <dl class="kv" style="margin-top:.6rem">
          <dt>Shop slug</dt><dd class="mono">${esc(s.shop.slug || '—')}</dd>
          <dt>Currency</dt><dd>${esc(st.currency || 'Rs')}</dd>
          <dt>Address</dt><dd>${esc(st.shop_address || '—')}</dd>
          <dt>Phone</dt><dd>${esc(st.shop_phone || '—')}</dd>
          <dt>Receipt footer</dt><dd>${esc(st.receipt_footer || '—')}</dd>
        </dl>
      </div>
      <div class="card">
        <h2>Account</h2>
        <p class="hint">Your shop runs on the real Rokar POS engine. More modules (billing, purchases, udhaar, reports) are on the way.</p>
        <dl class="kv">
          <dt>User id</dt><dd>${me && me.id != null ? me.id : '—'}</dd>
          <dt>Username</dt><dd>${esc((me && me.username) || '—')}</dd>
          <dt>Role</dt><dd class="mono">${esc((me && me.role) || '—')}</dd>
          <dt>Trial ends</dt><dd>${fmtDay(s.shop && s.shop.trial_ends_at)}</dd>
        </dl>
      </div>`;
  }

  // ---------- inventory ----------

  async function renderInventory(box, products, cur) {
    box.innerHTML = `
      <div class="card">
        <h2>Add product</h2>
        <div class="row" style="gap:.6rem;flex-wrap:wrap" id="inv-form">
          <input name="name" placeholder="Product name*" style="flex:2;min-width:180px;padding:.5rem .65rem;border:1px solid var(--line);border-radius:8px" />
          <input name="cost" type="number" step="any" placeholder="Cost" style="width:110px;padding:.5rem .65rem;border:1px solid var(--line);border-radius:8px" />
          <input name="sale" type="number" step="any" placeholder="Sale*" style="width:110px;padding:.5rem .65rem;border:1px solid var(--line);border-radius:8px" />
          <input name="stock" type="number" step="any" placeholder="Stock" style="width:100px;padding:.5rem .65rem;border:1px solid var(--line);border-radius:8px" />
          <button class="btn" id="btn-add-product">Add</button>
        </div>
        <p class="small muted" style="margin:.5rem 0 0">A barcode and SKU are generated automatically when you leave them blank.</p>
      </div>
      <div class="card">
        <h2>Products <span class="muted small">(${products.length})</span></h2>
        <div id="inv-msg"></div>
        ${products.length === 0
          ? '<div class="empty">No products yet — add your first product above.</div>'
          : `<table class="list">
              <thead><tr><th>Name</th><th>Barcode</th><th>Unit</th><th class="num">Cost</th><th class="num">Sale</th><th class="num">Stock</th><th>Actions</th></tr></thead>
              <tbody>
                ${products.map((p) => `
                  <tr>
                    <td>${esc(p.name)}</td>
                    <td class="mono small">${esc(p.barcode || '—')}</td>
                    <td class="small">${esc(p.unit_name || p.unit_symbol || '—')}</td>
                    <td class="num small">${fmtMoney(p.cost_price, cur)}</td>
                    <td class="num">${fmtMoney(p.sale_price, cur)}</td>
                    <td class="num"><strong>${Number(p.stock_qty)}</strong></td>
                    <td>
                      <button class="btn ghost small-act" data-act="${p.id}" style="padding:.25rem .6rem;font-size:.8rem">Adjust</button>
                      <button class="btn ghost small-act danger-text" data-del="${p.id}" style="padding:.25rem .6rem;font-size:.8rem;color:var(--danger)">Delete</button>
                    </td>
                  </tr>
                  ${state.adjustFor === p.id ? `
                  <tr><td colspan="7">
                    <div class="adjust-box">
                      <span class="small">Adjust stock for <strong>${esc(p.name)}</strong>:</span>
                      <input type="number" step="any" id="adj-qty" value="0" placeholder="+/- qty" />
                      <input type="text" id="adj-reason" placeholder="reason (e.g. Restock, Damaged)" style="width:200px" />
                      <button class="btn" data-apply="${p.id}" style="padding:.3rem .7rem;font-size:.83rem">Apply</button>
                      <button class="btn ghost" data-cancel="1" style="padding:.3rem .7rem;font-size:.83rem">Cancel</button>
                    </div>
                  </td></tr>` : ''}
                `).join('')}
              </tbody>
            </table>`}
      </div>`;

    const addBtn = document.getElementById('btn-add-product');
    addBtn.addEventListener('click', async () => {
      const f = document.getElementById('inv-form');
      const name = f.querySelector('[name=name]').value.trim();
      const sale = parseFloat(f.querySelector('[name=sale]').value);
      if (!name) return msgEl('inv-msg', 'Product name is required', true);
      const cost = parseFloat(f.querySelector('[name=cost]').value);
      const stock = parseFloat(f.querySelector('[name=stock]').value);
      addBtn.disabled = true;
      try {
        await rpc('inventory:create', [{
          name,
          cost_price: isNaN(cost) ? 0 : cost,
          sale_price: isNaN(sale) ? 0 : sale,
          stock_qty: isNaN(stock) ? 0 : stock,
        }]);
        msgEl('inv-msg', 'Product added.', false);
        renderInventoryInto(box, null, cur);
      } catch (err) {
        msgEl('inv-msg', err.message, true);
        addBtn.disabled = false;
      }
    });

    box.querySelectorAll('[data-act]').forEach((b) =>
      b.addEventListener('click', () => {
        state.adjustFor = (state.adjustFor === Number(b.dataset.act)) ? null : Number(b.dataset.act);
        renderInventoryInto(box, null, cur);
      }));
    box.querySelectorAll('[data-apply]').forEach((b) =>
      b.addEventListener('click', async () => {
        const qty = parseFloat(box.querySelector('#adj-qty').value);
        const reason = box.querySelector('#adj-reason').value.trim() || 'Manual adjustment';
        if (!qty || isNaN(qty)) return msgEl('inv-msg', 'Enter a non-zero quantity', true);
        b.disabled = true;
        try {
          await rpc('inventory:adjustStock', [Number(b.dataset.apply), qty, reason]);
          state.adjustFor = null;
          msgEl('inv-msg', 'Stock adjusted.', false);
          renderInventoryInto(box, null, cur);
        } catch (err) {
          msgEl('inv-msg', err.message, true);
          b.disabled = false;
        }
      }));
    const cancelBtn = box.querySelector('[data-cancel]');
    if (cancelBtn) cancelBtn.addEventListener('click', () => {
      state.adjustFor = null;
      renderInventoryInto(box, null, cur);
    });
    box.querySelectorAll('[data-del]').forEach((b) =>
      b.addEventListener('click', async () => {
        if (!confirm(`Delete product #${b.dataset.del}? This cannot be undone.`)) return;
        b.disabled = true;
        try {
          await rpc('inventory:remove', [Number(b.dataset.del)]);
          msgEl('inv-msg', 'Product deleted.', false);
          renderInventoryInto(box, null, cur);
        } catch (err) {
          msgEl('inv-msg', err.message, true);
          b.disabled = false;
        }
      }));
  }

  function msgEl(id, text, isErr) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = `<div class="alert ${isErr ? 'err' : 'ok'}">${esc(text)}</div>`;
  }

  function renderInventoryInto(box, _unused, cur) {
    rpc('inventory:list', []).then((products) => renderInventory(box, products, cur)).catch((err) => {
      box.innerHTML = `<div class="alert err">${esc(err.message)}</div>`;
    });
  }

  // ---------- users ----------

  async function renderUsers(box, data) {
    const users = data.users || [];
    const me = data.me;
    const isOwner = (me && me.role) === 'owner';
    box.innerHTML = `
      <div class="card">
        <h2>Add user</h2>
        <p class="hint">Create a manager or cashier to share the shop with your team.</p>
        <div class="row" style="gap:.6rem;flex-wrap:wrap" id="user-form">
          <input name="username" placeholder="Username*" style="flex:1;min-width:150px;padding:.5rem .65rem;border:1px solid var(--line);border-radius:8px" />
          <select name="role" style="width:130px;padding:.5rem .65rem;border:1px solid var(--line);border-radius:8px">
            <option value="cashier">Cashier</option>
            <option value="manager">Manager</option>
            <option value="owner">Owner</option>
          </select>
          <input name="pin" placeholder="PIN" style="width:110px;padding:.5rem .65rem;border:1px solid var(--line);border-radius:8px" />
          <input name="password" placeholder="Password" type="password" style="width:150px;padding:.5rem .65rem;border:1px solid var(--line);border-radius:8px" />
          <button class="btn" id="btn-add-user">Add</button>
        </div>
        <p class="small muted" style="margin:.5rem 0 0">Minimum PIN: 4 digits. Password is optional for pin-only users.</p>
        <div id="user-msg"></div>
      </div>
      <div class="card">
        <h2>Users <span class="muted small">(${users.length})</span></h2>
        <table class="list">
          <thead><tr><th>#</th><th>Username</th><th>Role</th><th>Status</th><th>Created</th>${isOwner ? '<th></th>' : ''}</tr></thead>
          <tbody>
            ${users.map((u) => `
              <tr>
                <td class="muted small">${u.id}${me && me.id === u.id ? ' <span class="plan-chip active">you</span>' : ''}</td>
                <td><strong>${esc(u.username)}</strong></td>
                <td class="mono small">${esc(u.role)}</td>
                <td class="small">${u.active ? 'Active' : 'Inactive'}</td>
                <td class="muted small">${fmtDay(u.created_at)}</td>
                ${isOwner ? `<td><button class="btn ghost del-user" data-id="${u.id}" style="padding:.25rem .6rem;font-size:.8rem;color:var(--danger)">Delete</button></td>` : ''}
              </tr>`).join('')}
          </tbody>
        </table>
        ${!isOwner ? '<p class="small muted" style="margin-top:.7rem">Only the owner can add or delete users.</p>' : ''}
      </div>`;

    const addBtn = document.getElementById('btn-add-user');
    addBtn.addEventListener('click', async () => {
      const f = document.getElementById('user-form');
      const username = f.querySelector('[name=username]').value.trim();
      const role = f.querySelector('[name=role]').value;
      const pin = f.querySelector('[name=pin]').value.trim();
      const password = f.querySelector('[name=password]').value;
      if (!username) return msgEl('user-msg', 'Username is required', true);
      if (pin && pin.length < 4) return msgEl('user-msg', 'PIN must be at least 4 digits', true);
      addBtn.disabled = true;
      try {
        await rpc('users:create', [{ username, role, password: password || undefined, pin: pin || undefined }]);
        msgEl('user-msg', 'User created.', false);
        loadTab('users');
      } catch (err) {
        msgEl('user-msg', err.message, true);
        addBtn.disabled = false;
      }
    });
    box.querySelectorAll('.del-user').forEach((b) =>
      b.addEventListener('click', async () => {
        if (!confirm(`Delete user #${b.dataset.id}?`)) return;
        b.disabled = true;
        try {
          await rpc('users:remove', [Number(b.dataset.id)]);
          msgEl('user-msg', 'User deleted.', false);
          loadTab('users');
        } catch (err) {
          msgEl('user-msg', err.message, true);
          b.disabled = false;
        }
      }));
  }

  // ---------- activity ----------

  function renderActivity(box, rows) {
    box.innerHTML = `
      <div class="card">
        <h2>Activity <span class="muted small">(latest ${(rows || []).length})</span></h2>
        ${!(rows && rows.length) ? '<div class="empty">No activity yet.</div>' : `
        <table class="list">
          <thead><tr><th>When</th><th>User</th><th>Action</th><th>Details</th></tr></thead>
          <tbody>
            ${rows.map((a) => `
              <tr>
                <td class="muted small">${esc(fmtDate(a.created_at))}</td>
                <td class="small">${esc(a.username || 'system')}</td>
                <td>${esc(a.action)}${a.entity ? ` <span class="muted small">· ${esc(a.entity)}${a.entity_id ? ' #' + esc(a.entity_id) : ''}</span>` : ''}</td>
                <td class="muted small">${esc(a.details || '')}</td>
              </tr>`).join('')}
          </tbody>
        </table>`}
      </div>`;
  }

  // ---------- settings ----------

  function renderSettings(box, settings, cur) {
    const editable = [
      ['shop_name', 'Shop name'],
      ['shop_address', 'Shop address'],
      ['shop_phone', 'Shop phone'],
      ['currency', 'Currency symbol'],
      ['receipt_footer', 'Receipt footer'],
    ];
    const s = session.get();
    const isOwner = (s.user && s.user.role) === 'owner';
    box.innerHTML = `
      <div class="card">
        <h2>Settings</h2>
        <p class="hint">${isOwner ? 'Saved changes apply to your whole shop.' : 'Only the owner can change settings.'}</p>
        <div id="set-msg"></div>
        <form id="settings-form">
          ${editable.map(([key, label]) => `
            <div class="field" style="max-width:520px">
              <label>${label}</label>
              <input name="${key}" value="${esc(settings[key] != null ? settings[key] : '')}" ${!isOwner ? 'disabled' : ''} />
            </div>`).join('')}
          <div class="field" style="max-width:520px"><label>Low-stock threshold</label>
            <input name="low_stock_threshold" value="${esc(settings.low_stock_threshold != null ? settings.low_stock_threshold : '')}" ${!isOwner ? 'disabled' : ''} /></div>
          <button class="btn" type="submit" ${!isOwner ? 'disabled' : ''}>Save changes</button>
        </form>
      </div>`;
    if (!isOwner) {
      document.getElementById('set-msg').innerHTML = '<div class="alert ok">You are signed in as a non-owner — changes are disabled. Ask the owner to update settings.</div>';
    }
    document.getElementById('settings-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      const fd = new FormData(f);
      const btn = f.querySelector('button[type=submit]');
      btn.disabled = true;
      try {
        for (const [key] of editable) {
          const v = String(fd.get(key) || '');
          if (v !== String(settings[key] != null ? settings[key] : '')) {
            await rpc('settings:set', [key, v]);
          }
        }
        msgEl('set-msg', 'Settings saved.', false);
        const s2 = session.get();
        if (s2) { s2.settings = Object.assign({}, s2.settings, Object.fromEntries([...fd.entries()])); session.set(s2); }
      } catch (err) {
        msgEl('set-msg', err.message, true);
      }
      btn.disabled = false;
    });
  }

  async function activateAccount() {
    const s = session.get();
    const btn = document.getElementById('btn-activate');
    if (btn) { btn.disabled = true; btn.textContent = 'Activating…'; }
    try {
      const { status, data } = await api('/api/activate', { method: 'POST', token: s.token });
      if (status !== 200 || !data || !data.ok) {
        throw new Error((data && data.error) || 'Activation failed');
      }
      const s2 = session.get();
      s2.shop = data.shop;
      session.set(s2);
      location.reload();
    } catch (err) {
      if (btn) { btn.disabled = false; btn.textContent = 'Activate account'; }
      alert(err.message);
    }
  }

  // ---------- router ----------

  const state = { adjustFor: null };

  function route() {
    const hash = location.hash || '#/';
    if (hash === '#/') return renderLanding();
    if (hash === '#/signup') return renderAuth('signup');
    if (hash === '#/login') return renderAuth('login');
    const m = hash.match(/^#\/app(?:\/(\w+))?$/);
    if (m) {
      const s = session.get();
      if (!s || !s.token) { location.hash = '#/login'; return; }
      state.adjustFor = null;
      return renderDashboard(m[1] || 'overview');
    }
    location.hash = '#/';
  }

  window.addEventListener('hashchange', route);
  route();
})();