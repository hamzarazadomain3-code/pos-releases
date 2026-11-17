import { speakableText, speechLanguageTag } from '../../../shared/assistant/voice';

/**
 * The voice that reads the answer out.
 *
 * It is the BROWSER's own voice (`speechSynthesis`), so it works in the desktop
 * app and in the web build alike, it needs no key, no cloud and no network —
 * the words are spoken by the operating system.
 */

/**
 * The browser's own speech recognition.
 *
 * The web build uses it (Chrome and Edge have it). The type is declared here
 * so the app does not depend on the DOM library shipping it.
 */
export interface BrowserSpeechRecognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

/** The browser's own speech recognition constructor (when it has one). */
export function browserSpeechRecognition(): (new () => BrowserSpeechRecognition) | null {
  const scope = globalThis as unknown as {
    SpeechRecognition?: new () => BrowserSpeechRecognition;
    webkitSpeechRecognition?: new () => BrowserSpeechRecognition;
  };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}

/** Can this computer read an answer out loud? */
export function speechSupported(): boolean {
  return (
    typeof globalThis.speechSynthesis !== 'undefined' &&
    typeof globalThis.SpeechSynthesisUtterance !== 'undefined'
  );
}

/** The voices the system offers (empty when it offers none). */
export function speechVoices(): SpeechSynthesisVoice[] {
  try {
    return globalThis.speechSynthesis?.getVoices?.() ?? [];
  } catch {
    return [];
  }
}

/**
 * The voice for a language — the system's own voice for that language when it
 * has one (an Urdu voice reads Urdu properly), otherwise whatever it has.
 */
export function voiceForLanguage(tag: string): SpeechSynthesisVoice | null {
  const voices = speechVoices();
  if (!voices.length) return null;
  const wanted = tag.toLowerCase();
  const prefix = wanted.split('-')[0];
  return (
    voices.find((v) => v.lang?.toLowerCase() === wanted) ??
    voices.find((v) => v.lang?.toLowerCase().startsWith(prefix)) ??
    voices.find((v) => v.default) ??
    voices[0] ??
    null
  );
}

/** Stop the voice (it is talking right now). */
export function stopSpeaking(): void {
  try {
    globalThis.speechSynthesis?.cancel?.();
  } catch {
    /* the voice may not be there */
  }
}

/** Is the voice talking right now? */
export function speakingNow(): boolean {
  try {
    return globalThis.speechSynthesis?.speaking === true;
  } catch {
    return false;
  }
}

/**
 * Read an answer out loud.
 *
 * The markdown is cleaned first (the `**bold**` and the code fences are noise
 * out loud) and the text is cut to a length a listener can follow. Returns
 * false when this computer has no voice — the caller then stays silent.
 */
export function speak(text: string, language?: string | null): boolean {
  if (!speechSupported()) return false;
  const clean = speakableText(text);
  if (!clean) return false;
  stopSpeaking();
  try {
    const utterance = new globalThis.SpeechSynthesisUtterance(clean);
    const tag = speechLanguageTag(language);
    utterance.lang = tag;
    const voice = voiceForLanguage(tag);
    if (voice) utterance.voice = voice;
    utterance.rate = 1;
    utterance.pitch = 1;
    globalThis.speechSynthesis.speak(utterance);
    return true;
  } catch {
    return false;
  }
}
