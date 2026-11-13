/**
 * Pure helpers for recovering from a WhatsApp Web page reload.
 *
 * whatsapp-web.js injects `window.WWebJS` into the WhatsApp Web page ONCE, at
 * startup. WhatsApp Web reloads its own page now and then, and a reload wipes
 * that object. Every later call that needs it dies with
 *
 *   "Cannot read properties of undefined (reading 'getChat')"
 *
 * The session itself is unaffected — it lives in the LocalAuth folder on disk —
 * so the cure is to re-inject (reconnect), NOT to ask the shop owner to scan
 * the QR code again.
 */

/** Does this error mean "the WhatsApp Web page was reloaded"? */
export function isWWebJsLost(message: string): boolean {
  if (!message) return false;
  return (
    /WWebJS/i.test(message) ||
    /reading 'getChat'/.test(message) ||
    /reading 'getChatId'/.test(message) ||
    /reading 'getMessages'/.test(message) ||
    /Cannot read propert(?:y|ies) of undefined/i.test(message)
  );
}

/** What the shop owner should be told, instead of a raw JS stack message. */
export function describeWhatsAppFailure(message: string): string {
  if (!message) return 'WhatsApp message could not be sent.';
  if (isWWebJsLost(message)) {
    return 'WhatsApp Web reloaded and the link was lost. Press Reconnect / Rescan QR in Settings → WhatsApp — your WhatsApp stays linked, you only have to reconnect.';
  }
  if (/Invalid phone number/i.test(message)) return 'Invalid phone number.';
  if (/ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ENETUNREACH/i.test(message)) {
    return 'No internet connection — WhatsApp needs the network to send.';
  }
  if (/not connected/i.test(message)) {
    return 'WhatsApp is not connected. Open Settings → WhatsApp and scan the QR code first.';
  }
  return message;
}
