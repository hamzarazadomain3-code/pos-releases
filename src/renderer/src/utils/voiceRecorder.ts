import { bytesToBase64, encodeWav16k } from '../../../shared/assistant/voice';

/**
 * The recorder — the microphone of the assistant.
 *
 * It records the RAW PCM (no codec, no file), and when the user stops it
 * builds the 16 kHz mono WAV that the Windows speech recogniser reads. The
 * audio never leaves the computer: the WAV goes straight to the app's own
 * recogniser over IPC.
 *
 * The web build has no Windows recogniser — the browser's own speech
 * recognition is used there instead (the panel knows the difference).
 */

/** One recording. */
export interface VoiceRecording {
  /** Stop the recording and get the WAV (base64). */
  stop: () => Promise<{ base64: string; bytes: number }>;
  /** Throw the recording away. */
  cancel: () => void;
}

/** Can this renderer record? */
export function recordingSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof globalThis.AudioContext !== 'undefined'
  );
}

/**
 * Start recording.
 *
 * Throws when the microphone is refused or missing — the caller turns that
 * into a plain-English message.
 */
export async function startVoiceRecording(): Promise<VoiceRecording> {
  if (!recordingSupported()) {
    throw new Error('This computer has no microphone for the assistant.');
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const context = new globalThis.AudioContext();
  const source = context.createMediaStreamSource(stream);
  const processor = context.createScriptProcessor(4096, 1, 1);
  // A silent sink: the processor must be connected to the graph to run, but
  // the audio must NOT go to the speakers (that would echo).
  const sink = context.createGain();
  sink.gain.value = 0;
  const chunks: Float32Array[] = [];

  processor.onaudioprocess = (event) => {
    const input = event.inputBuffer.getChannelData(0);
    chunks.push(new Float32Array(input));
  };
  source.connect(processor);
  processor.connect(sink);
  sink.connect(context.destination);

  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    try {
      processor.onaudioprocess = null;
      source.disconnect();
      processor.disconnect();
      sink.disconnect();
    } catch {
      /* the graph may already be closed */
    }
    for (const track of stream.getTracks()) {
      try {
        track.stop();
      } catch {
        /* the track may already be gone */
      }
    }
    try {
      await context.close();
    } catch {
      /* the context may already be closed */
    }
  };

  const sampleRate = context.sampleRate || 48000;

  return {
    stop: async () => {
      const rate = sampleRate;
      await close();
      let total = 0;
      for (const chunk of chunks) total += chunk.length;
      const pcm = new Float32Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        pcm.set(chunk, offset);
        offset += chunk.length;
      }
      const wav = encodeWav16k(pcm, rate);
      return { base64: bytesToBase64(wav), bytes: wav.length };
    },
    cancel: () => {
      void close();
    },
  };
}
