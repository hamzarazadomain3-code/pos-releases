/**
 * THE app logo — Rokar POS's own mark, never the shop's.
 *
 * The rule this module exists to enforce:
 *
 *   POS app UI (login, lock, sidebar)   -> APP logo only
 *   printed / exported documents        -> SHOP logo only (nothing if unset)
 *   designers' print-preview canvas     -> SHOP logo (it previews the paper)
 *
 * So on-screen chrome must import from here, and must never read
 * `settings.shop_logo`. The print paths (`receiptTemplates`, `renderDocument`,
 * `printDocs`) read `shop_logo` and print nothing when it is empty — they never
 * fall back to these assets.
 *
 * The files are the branding pipeline's output (`build/build_branding.py`);
 * do not hand-edit the PNGs.
 */
import appLogoLight from '../assets/rokar-pos-logo-light.png';
import appMarkDark from '../assets/rokar-pos-mark-dark.png';

/** The full lockup used on the login / recovery / lock screens. */
export const APP_LOGO_LIGHT = appLogoLight;

/** The compact mark used in the sidebar brand slot. */
export const APP_MARK_DARK = appMarkDark;
