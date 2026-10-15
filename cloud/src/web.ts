// web — serves the single-page web dashboard (src/web/assets, bundled into
// generated-web.ts) plus its stylesheet and script. The dashboard is a
// dependency-free SPA that talks exclusively to this worker's /api/* JSON
// endpoints, so everything it renders is real service data.
import { APP_HTML, APP_JS, APP_CSS } from './generated-web';

export function serveApp(pathname: string): Response | null {
  if (pathname === '/') {
    return new Response(APP_HTML, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
  }
  if (pathname === '/app.js') {
    return new Response(APP_JS, { status: 200, headers: { 'content-type': 'text/javascript; charset=utf-8' } });
  }
  if (pathname === '/style.css') {
    return new Response(APP_CSS, { status: 200, headers: { 'content-type': 'text/css; charset=utf-8' } });
  }
  return null;
}