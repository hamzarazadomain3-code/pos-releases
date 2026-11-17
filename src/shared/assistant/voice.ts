/**
 * The voice + attachment helpers — the PURE half of the voice/photo feature.
 *
 * Everything in this file is deterministic and side-effect free, so the
 * permanent test can import the REAL `dist` code and check it without a
 * microphone, a network or a model:
 *
 *  - the WAV encoder (the recorder's raw PCM → the 16 kHz mono WAV that the
 *    Windows speech recogniser reads),
 *  - the base64 helpers,
 *  - the rules for WHICH file may be attached (an image the model can look at,
 *    or a text file whose words go into the prompt),
 *  - the clean-up of an answer before it is spoken.
 *
 * The renderer and the main process both use this file; the renderer bundles it
 * and the main process imports it from `dist`.
 */

/** The kinds of file the assistant can take. */
export type AssistantAttachmentKind = 'image' | 'text';

/** One file the user attached to a question. */
export interface AssistantAttachment {
  /** 'image' — the model can LOOK at it; 'text' — the words go into the prompt. */
  kind: AssistantAttachmentKind;
  /** The MIME type ('image/png', 'text/csv'…). */
  mediaType: string;
  /** The file name (shown in the chat). */
  name: string;
  /** The base64 payload (an image) or the plain text (a text file). */
  data: string;
}

/** The biggest image the assistant takes (4 MB — the base64 grows by a third). */
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
/** The biggest text file the assistant takes. */
export const MAX_TEXT_BYTES = 20_000;
/** How many files one question may carry. */
export const MAX_ATTACHMENTS = 4;
/** The longest answer the voice reads out (a shop answer is never longer). */
export const MAX_SPEAK_CHARS = 2000;
/** The sample rate the Windows speech recogniser wants. */
export const SPEECH_SAMPLE_RATE = 16_000;

/** The image types the providers accept. */
export const SUPPORTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

/** The text file types the assistant reads as words. */
export const SUPPORTED_TEXT_EXTENSIONS = ['txt', 'csv', 'json', 'md', 'log', 'xml', 'yml', 'yaml', 'ini'];

/** Is this MIME type an image the model can look at? */
export function isImageMediaType(mediaType: string): boolean {
  const type = (mediaType || '').split(';')[0].trim().toLowerCase();
  return SUPPORTED_IMAGE_TYPES.includes(type);
}

/** The file's extension (lower case, without the dot). */
export function fileExtension(name: string): string {
  const text = String(name || '');
  const dot = text.lastIndexOf('.');
  if (dot <= 0 || dot === text.length - 1) return '';
  return text.slice(dot + 1).toLowerCase();
}

/**
 * Which kind of attachment this file is — or `null` when the assistant must
 * refuse it (a video, an executable, a document it cannot read).
 */
export function attachmentKindFor(name: string, mediaType: string): AssistantAttachmentKind | null {
  if (isImageMediaType(mediaType)) return 'image';
  const ext = fileExtension(name);
  if (SUPPORTED_TEXT_EXTENSIONS.includes(ext)) return 'text';
  // A text/* MIME type without a useful extension is still text.
  const type = (mediaType || '').split(';')[0].trim().toLowerCase();
  if (type.startsWith('text/') || type === 'application/json') return 'text';
  return null;
}

/** The size limit for a kind of attachment. */
export function maxBytesFor(kind: AssistantAttachmentKind): number {
  return kind === 'image' ? MAX_IMAGE_BYTES : MAX_TEXT_BYTES;
}

/**
 * Split a data URL into its media type and its base64 payload.
 *
 * The browser's `FileReader` gives a data URL; the providers want the raw
 * base64 (Anthropic) or the whole data URL (OpenAI-compatible).
 */
export function splitDataUrl(dataUrl: string): { mediaType: string; base64: string } {
  const text = String(dataUrl || '');
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(text);
  if (!match) return { mediaType: '', base64: '' };
  return {
    mediaType: (match[1] || '').trim().toLowerCase(),
    base64: match[3] || '',
  };
}

/** The bytes of a base64 string (no Node, no atob — it runs everywhere). */
export function base64ToBytes(base64: string): Uint8Array {
  const clean = String(base64 || '').replace(/[^A-Za-z0-9+/=]/g, '');
  const lookup = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < clean.length; i += 1) {
    const char = clean[i];
    if (char === '=') break;
    const value = lookup.indexOf(char);
    if (value < 0) continue;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return Uint8Array.from(bytes);
}

/** The base64 of some bytes (no Node, no btoa — it runs everywhere). */
export function bytesToBase64(bytes: Uint8Array): string {
  const lookup = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const triple = (b0 << 16) | (b1 << 8) | b2;
    out += lookup[(triple >> 18) & 63];
    out += lookup[(triple >> 12) & 63];
    out += i + 1 < bytes.length ? lookup[(triple >> 6) & 63] : '=';
    out += i + 2 < bytes.length ? lookup[triple & 63] : '=';
  }
  return out;
}

/** The base64 of a UTF-8 string (the text files travel as base64 too). */
export function textToBase64(text: string): string {
  const utf8 = new TextEncoder().encode(String(text ?? ''));
  return bytesToBase64(utf8);
}

/** A UTF-8 string from some base64. */
export function base64ToText(base64: string): string {
  return new TextDecoder().decode(base64ToBytes(base64));
}

/**
 * Resample raw PCM to 16 kHz (the rate the Windows recogniser reads).
 *
 * A plain linear interpolation — good enough for speech, and it keeps the
 * whole thing dependency free.
 */
export function downsampleTo16k(pcm: Float32Array, sampleRate: number): Float32Array {
  if (!sampleRate || sampleRate <= 0) return pcm;
  if (sampleRate === SPEECH_SAMPLE_RATE) return pcm;
  const ratio = sampleRate / SPEECH_SAMPLE_RATE;
  const length = Math.max(1, Math.floor(pcm.length / ratio));
  const out = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    const position = i * ratio;
    const index = Math.floor(position);
    const frac = position - index;
    const a = pcm[index] ?? 0;
    const b = pcm[index + 1] ?? a;
    out[i] = a + (b - a) * frac;
  }
  return out;
}

/**
 * The 16-bit mono WAV of some raw PCM.
 *
 * The header is the classic 44-byte RIFF/WAVE header; the samples are clamped
 * to -1..1 and written as little-endian signed 16-bit.
 */
export function encodeWav16k(pcm: Float32Array, sampleRate: number): Uint8Array {
  const samples = downsampleTo16k(pcm, sampleRate);
  const dataSize = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeAscii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };
  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true); // the PCM chunk size
  view.setUint16(20, 1, true); // PCM (not float)
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, SPEECH_SAMPLE_RATE, true);
  view.setUint32(28, SPEECH_SAMPLE_RATE * 2, true); // the byte rate
  view.setUint16(32, 2, true); // the block align
  view.setUint16(34, 16, true); // the bits per sample
  writeAscii(36, 'data');
  view.setUint32(40, dataSize, true);
  let offset = 44;
  for (let i = 0; i < samples.length; i += 1) {
    const value = Math.max(-1, Math.min(1, samples[i] ?? 0));
    view.setInt16(offset, value < 0 ? value * 0x8000 : value * 0x7fff, true);
    offset += 2;
  }
  return new Uint8Array(buffer);
}

/**
 * The answer, cleaned up for the voice.
 *
 * The markdown (the `**bold**`, the `#` headings, the code fences, the links)
 * is noise out loud — it is stripped, and the text is cut to the length a
 * listener can follow.
 */
export function speakableText(text: string): string {
  let out = String(text || '');
  out = out.replace(/```[\s\S]*?```/g, ' ');
  out = out.replace(/`([^`]*)`/g, '$1');
  out = out.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ');
  out = out.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
  out = out.replace(/^\s{0,3}#{1,6}\s+/gm, '');
  out = out.replace(/\*\*([^*]+)\*\*/g, '$1');
  out = out.replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, '$1$2');
  out = out.replace(/^\s{0,3}>\s?/gm, '');
  out = out.replace(/^\s*[-*+]\s+/gm, '');
  out = out.replace(/[|*_~]{1,3}/g, ' ');
  out = out.replace(/\s+/g, ' ').trim();
  if (out.length > MAX_SPEAK_CHARS) out = `${out.slice(0, MAX_SPEAK_CHARS).trimEnd()}…`;
  return out;
}

/** The language tag the voice should read the answer in. */
export function speechLanguageTag(language: string | null | undefined): string {
  const code = String(language || '').toLowerCase();
  if (code === 'ur' || code.startsWith('ur-')) return 'ur-PK';
  if (code === 'roman' || code.startsWith('ro')) return 'en-US';
  if (code.startsWith('en')) return 'en-US';
  return 'en-US';
}

/**
 * The text of a text-file attachment, ready for the prompt.
 *
 * The words go into the prompt as a named block — the model then knows the
 * file's content is DATA, never an instruction.
 */
export function attachmentTextBlock(attachment: AssistantAttachment): string {
  const text = attachment.kind === 'text' ? base64ToText(attachment.data) : attachment.data;
  return `Attached file "${attachment.name}":\n"""\n${text}\n"""`;
}

/** A file the main process refused (with the reason, in plain words). */
export interface AttachmentRejection {
  name: string;
  reason: 'too_big' | 'not_supported' | 'broken' | 'too_many';
}

/** The clean name of a file (no path, no control characters, short). */
export function cleanAttachmentName(name: string): string {
  const raw = String(name || '').replace(/[\\/]+/g, ' ').replace(/[\u0000-\u001f]/g, '').trim();
  if (!raw) return 'file';
  // Only the last piece of a path is shown ("C:\shop\bill.png" → "bill.png").
  const parts = raw.split(' ').filter(Boolean);
  const last = parts.length ? parts[parts.length - 1] : raw;
  return last.length > 120 ? last.slice(0, 120) : last;
}

/**
 * The attachments the main process ACCEPTS.
 *
 * The renderer already refuses the files it cannot handle, but the renderer is
 * not trusted: this is the gate that really decides what may leave the shop.
 * A file that is too big, of an unknown type or broken is DROPPED (and
 * reported), never passed on.
 */
export function sanitizeAttachments(input: unknown): {
  attachments: AssistantAttachment[];
  rejected: AttachmentRejection[];
} {
  const attachments: AssistantAttachment[] = [];
  const rejected: AttachmentRejection[] = [];
  if (!Array.isArray(input)) return { attachments, rejected };
  for (const raw of input) {
    if (attachments.length >= MAX_ATTACHMENTS) {
      rejected.push({ name: cleanAttachmentName(String((raw as { name?: unknown })?.name ?? '')), reason: 'too_many' });
      continue;
    }
    const item = (raw ?? {}) as Partial<AssistantAttachment>;
    const name = cleanAttachmentName(String(item.name ?? ''));
    const kind = item.kind === 'image' || item.kind === 'text' ? item.kind : null;
    const data = typeof item.data === 'string' ? item.data : '';
    if (!kind) {
      rejected.push({ name, reason: 'not_supported' });
      continue;
    }
    if (!data) {
      rejected.push({ name, reason: 'broken' });
      continue;
    }
    const bytes = base64ToBytes(data);
    if (!bytes.length) {
      rejected.push({ name, reason: 'broken' });
      continue;
    }
    if (bytes.length > maxBytesFor(kind)) {
      rejected.push({ name, reason: 'too_big' });
      continue;
    }
    if (kind === 'image') {
      const mediaType = String(item.mediaType || '').split(';')[0].trim().toLowerCase();
      if (!SUPPORTED_IMAGE_TYPES.includes(mediaType)) {
        rejected.push({ name, reason: 'not_supported' });
        continue;
      }
      attachments.push({ kind, mediaType, name, data });
      continue;
    }
    attachments.push({
      kind,
      mediaType: String(item.mediaType || 'text/plain').split(';')[0].trim().toLowerCase(),
      name,
      data,
    });
  }
  return { attachments, rejected };
}
