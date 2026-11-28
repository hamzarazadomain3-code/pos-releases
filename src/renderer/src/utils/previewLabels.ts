import type { PrintPreviewLabels } from '../../../shared/types';

/**
 * The preview window's toolbar labels, in the shop's language.
 *
 * Phase 4, item 5 — the preview toolbar is injected by the MAIN process (it
 * lives in a plain `BrowserWindow` with no preload), so it cannot read the
 * renderer's i18n files. The renderer therefore sends the TRANSLATED strings
 * with the request, and the main process falls back to English when they are
 * absent (so an old caller still works).
 *
 * `kind` only changes the main button: a receipt says "Print receipt", an
 * invoice says "Print invoice".
 */
export function previewLabels(
  t: (key: string) => string,
  kind: 'receipt' | 'invoice' = 'receipt'
): PrintPreviewLabels {
  return {
    print: t(kind === 'invoice' ? 'printing.preview.printInvoice' : 'printing.preview.print'),
    pdf: t('printing.preview.pdf'),
    whatsapp: t('printing.preview.whatsapp'),
    close: t('printing.preview.close'),
    copies: t('printing.preview.copies'),
    printing: t('printing.preview.printing'),
    saving: t('printing.preview.saving'),
    sending: t('printing.preview.sending'),
    error: t('printing.preview.error'),
  };
}
