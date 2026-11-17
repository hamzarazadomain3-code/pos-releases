/**
 * The voice service — the app's own speech recognition.
 *
 * The voice input runs OFFLINE on Windows: the recorder's WAV goes to the
 * Windows speech recogniser (`System.Speech`), which lives on the computer and
 * needs no key, no cloud and no network. The script that drives it ships as a
 * resource (`resources/voice/transcribe.ps1`).
 *
 * The web build has no Windows recogniser — the browser's own speech
 * recognition is used there instead (the renderer knows the difference).
 *
 * The audio NEVER leaves the computer: it is written to a temporary file, read
 * back, and deleted.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { base64ToBytes } from '../../../shared/assistant/voice';
import type {
  AssistantTranscriptionResult,
  AssistantVoiceSupport,
} from '../../../shared/assistant/types';

/** How long the recogniser may take (a short clip is a second or two). */
const RECOGNISE_TIMEOUT_MS = 30_000;

/**
 * Where the recogniser script lives.
 *
 * A PACKED app keeps its extra resources next to the executable
 * (`resources/voice/transcribe.ps1`); a development run finds them in the
 * project folder.
 */
export function transcribeScriptPath(): string | null {
  const candidates = [
    // The packed app: `<resources>/voice/transcribe.ps1`.
    process.resourcesPath ? join(process.resourcesPath, 'voice', 'transcribe.ps1') : '',
    // The development run: `dist/main/services/assistant` → the project root.
    resolve(__dirname, '..', '..', '..', '..', 'resources', 'voice', 'transcribe.ps1'),
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      if (existsSync(candidate)) return candidate;
    } catch {
      /* keep looking */
    }
  }
  return null;
}

/** What this computer can do with the voice. */
export function voiceSupport(): AssistantVoiceSupport {
  return {
    stt: transcribeScriptPath() ? 'windows' : 'none',
    // The answer is read out by the renderer (the browser's own voice), so the
    // TTS is always available where the panel runs.
    tts: true,
  };
}

/** Run the recogniser and read one JSON line back. */
function runRecogniser(script: string, wavPath: string): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Wav', wavPath],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }
    );
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* the process is already gone */
      }
      rejectPromise(new Error('The speech recogniser took too long.'));
    }, RECOGNISE_TIMEOUT_MS);
    child.stdout?.on('data', (chunk) => {
      out += String(chunk);
    });
    child.stderr?.on('data', (chunk) => {
      err += String(chunk);
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      rejectPromise(e);
    });
    child.on('close', () => {
      clearTimeout(timer);
      const line = out
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
        .pop();
      if (line) {
        resolvePromise(line);
        return;
      }
      rejectPromise(new Error(err.trim() || 'The speech recogniser said nothing.'));
    });
  });
}

/**
 * What the user said.
 *
 * The WAV arrives base64-encoded from the recorder; it is written to a
 * temporary file, recognised and deleted. Nothing is logged.
 */
export async function transcribeWav(wavBase64: string): Promise<AssistantTranscriptionResult> {
  const script = transcribeScriptPath();
  if (!script) {
    return {
      ok: false,
      text: '',
      message: 'Voice input needs the Windows speech recogniser, which is not on this computer.',
    };
  }
  const bytes = base64ToBytes(wavBase64);
  if (!bytes || bytes.length < 44) {
    return { ok: false, text: '', message: 'The recording was empty.' };
  }
  let folder = '';
  let wavPath = '';
  try {
    folder = await mkdtemp(join(tmpdir(), 'rokar-voice-'));
    wavPath = join(folder, 'clip.wav');
    await writeFile(wavPath, Buffer.from(bytes));
    const line = await runRecogniser(script, wavPath);
    let parsed: { ok?: boolean; text?: string; message?: string } = {};
    try {
      parsed = JSON.parse(line) as { ok?: boolean; text?: string; message?: string };
    } catch {
      return { ok: false, text: '', message: 'The speech recogniser did not answer properly.' };
    }
    if (parsed.ok === false) {
      return { ok: false, text: '', message: parsed.message || 'The speech recogniser could not read that.' };
    }
    return { ok: true, text: String(parsed.text ?? '').trim() };
  } catch (e) {
    return {
      ok: false,
      text: '',
      message: e instanceof Error ? e.message : String(e),
    };
  } finally {
    if (folder) {
      try {
        await rm(folder, { recursive: true, force: true });
      } catch {
        /* the temporary folder cleans itself up eventually */
      }
    }
  }
}
