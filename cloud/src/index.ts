// Rokar POS web foundation entry — a Cloudflare Worker module.
//
//   default.fetch  routes the public HTTP API (/api/signup, /api/login,
//                  /api/rpc, /api/health) to the D1 ACCOUNTS front door.
//   exported ShopObject is the per-shop Durable Object class that wrangler
//                  instantiates via the SHOP binding.

import { handleSignup, handleLogin, handleRpc, handleActivate, handleHealth } from './accounts';
import { json } from './http';
import { serveApp } from './web';
import type { Env } from './env';

export { ShopObject } from './shop-object';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // GET / serves the lite web dashboard (HTML + its JS/CSS assets); every /api/*
    // route stays JSON.
    if (request.method === 'GET') {
      // /app is the full desktop renderer, served from the ASSETS binding (assets
      // are normally served before the Worker runs; this is the explicit fallback).
      if (url.pathname === '/app' || url.pathname.startsWith('/app/')) {
        if (env.ASSETS) return env.ASSETS.fetch(request);
        return json({ ok: false, error: 'App assets unavailable' }, 404);
      }
      const asset = serveApp(url.pathname);
      if (asset) return asset;
    }
    if (request.method === 'GET' && url.pathname === '/api/health') {
      return handleHealth();
    }
    if (request.method === 'POST' && url.pathname === '/api/signup') {
      return handleSignup(env, request);
    }
    if (request.method === 'POST' && url.pathname === '/api/login') {
      return handleLogin(env, request);
    }
    if (request.method === 'POST' && url.pathname === '/api/rpc') {
      return handleRpc(env, request);
    }
    if (request.method === 'POST' && url.pathname === '/api/activate') {
      return handleActivate(env, request);
    }
    return json({ ok: false, error: 'Not found' }, 404);
  },
};