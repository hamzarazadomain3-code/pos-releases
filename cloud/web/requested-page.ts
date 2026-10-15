// requested-page — lets a URL deep-link into a specific desktop page WITHOUT
// touching the renderer.
//
// The desktop shell has no URL routing: App.tsx keeps the active page in React
// state and always starts on `billing`. So the web build honours `?page=dashboard`
// (or any nav key) by clicking the matching sidebar item once the signed-in shell
// has rendered. The label is resolved through the renderer's OWN i18n singleton, so
// it matches the button's `data-label` in whatever language the shop uses.
//
// A `cashier` has no Dashboard item, so this simply no-ops and the app stays on
// Billing — which is the role-correct outcome.
import i18n from '../../src/renderer/src/i18n';

const PAGE_QUERY = 'page';

function requestedPage(): string | null {
  try {
    const value = new URL(window.location.href).searchParams.get(PAGE_QUERY);
    return value ? value.trim() : null;
  } catch {
    return null;
  }
}

function clickPage(page: string): boolean {
  let label: string;
  try {
    label = i18n.t(`navigation.${page}`) as string;
  } catch {
    return false;
  }
  // i18next returns the key itself when the translation is missing.
  if (!label || label === `navigation.${page}`) return false;
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('.sidebar-nav .nav-btn'));
  const target = buttons.find((b) => b.dataset.label === label || b.getAttribute('aria-label') === label);
  if (!target) return false;
  target.click();
  return true;
}

/**
 * Applies `?page=` once the signed-in shell (and its sidebar) has rendered. Polls
 * briefly so it also fires when the shell appears after an interactive login rather
 * than an auto-restore.
 */
export function applyRequestedPage(): void {
  const page = requestedPage();
  if (!page) return;
  if (clickPage(page)) return; // already mounted (e.g. session restored)

  const STEP = 400;
  const LIMIT = 120_000;
  let elapsed = 0;
  const timer = window.setInterval(() => {
    elapsed += STEP;
    if (clickPage(page) || elapsed >= LIMIT) window.clearInterval(timer);
  }, STEP);
}
