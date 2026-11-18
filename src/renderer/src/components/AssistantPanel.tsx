import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AssistantMessage, AssistantPendingAction } from '../../../shared/assistant/types';
import {
  attachmentKindFor,
  bytesToBase64,
  cleanAttachmentName,
  MAX_ATTACHMENTS,
  maxBytesFor,
  splitDataUrl,
  textToBase64,
  type AssistantAttachment,
} from '../../../shared/assistant/voice';
import { sanitizeMessage, sanitizePlainText } from '../../../shared/assistant/sanitize';
import { chipsForContext } from '../../../shared/assistant/chips';
import { loadHistory, saveHistory, clearHistory, type StoredAssistantMessage } from '../../../shared/assistant/history';
import { detectLanguage } from '../../../shared/assistant/language';
import { billCommandFromResult, type AssistantBillCommand } from '../../../shared/assistant/billActions';
import type { ProactiveSuggestion } from '../../../shared/assistant/proactive';
import { formatMoney } from '../utils/currency';
import { speak, speechSupported, stopSpeaking, browserSpeechRecognition, type BrowserSpeechRecognition } from '../utils/speech';
import { speakableText } from '../../../shared/assistant/voice';
import { recordingSupported, startVoiceRecording, type VoiceRecording } from '../utils/voiceRecorder';

/**
 * The assistant panel.
 *
 * It is a PANEL, not a modal: it never takes the focus away from the page
 * unless the user opened it, it gives the focus back when it closes, and it
 * does not swallow the barcode scanner's keystrokes (the scanner listens on
 * the window and the panel's input only stops the propagation of ITS OWN
 * keys).
 *
 * The answers are rendered as React elements from the sanitized blocks — no
 * raw HTML ever reaches the DOM.
 */
export interface AssistantPanelProps {
  open: boolean;
  onClose: () => void;
  /** The route the user is on (the chips and the guide use it). */
  route: string | null;
  /** The signed-in user's role (the chips are filtered by it). */
  role: string | null | undefined;
  /** The signed-in user's id (the history is per user). */
  userId: number;
  /** Called when the assistant asks for a page to open. */
  onNavigate?: (route: string) => void;
  /** Called when the assistant asks for a guide to start. */
  onStartGuide?: (guideId: string) => void;
  /**
   * Called when the owner confirms a BILLING action (add to the open bill,
   * hold the open bill). The bill lives in the Billing screen, so the panel
   * only hands the command over.
   */
  onBillCommand?: (command: AssistantBillCommand) => void;
  /** Called when the user turns the assistant off for their OWN account. */
  onOptOut?: () => void;
}

interface PanelMessage extends StoredAssistantMessage {
  id: string;
  /** The tool the answer came from (the source line under the answer). */
  source?: string;
  /** A pending action the assistant proposed. */
  pending?: AssistantPendingAction;
  failed?: boolean;
  /** The photos/files the user sent with this message (not persisted). */
  attachments?: PanelAttachment[];
}

/** A file the user attached — the same shape the main process expects. */
interface PanelAttachment extends AssistantAttachment {
  /** The id of the chip in the composer (so a file can be removed again). */
  id: string;
  /** The picture the user sees (an image only). */
  preview?: string;
}

const FEEDBACK_KEY = 'assistant_feedback';
/** The voice-only mode is the user's OWN choice (this computer, this account). */
const VOICE_ONLY_KEY = 'assistant_voice_only';

function readVoiceOnly(): boolean {
  try {
    return globalThis.localStorage?.getItem(VOICE_ONLY_KEY) === '1';
  } catch {
    return false;
  }
}

function writeVoiceOnly(value: boolean): void {
  try {
    if (value) globalThis.localStorage?.setItem(VOICE_ONLY_KEY, '1');
    else globalThis.localStorage?.removeItem(VOICE_ONLY_KEY);
  } catch {
    /* storage is optional */
  }
}

/** The browser's own speech recognition (the web build uses it). */
function browserRecognition(): (new () => BrowserSpeechRecognition) | null {
  return browserSpeechRecognition();
}function feedbackKey(messageId: string): string {
  return `${FEEDBACK_KEY}_${messageId}`;
}

function readFeedback(messageId: string): 'up' | 'down' | null {
  try {
    const value = globalThis.localStorage?.getItem(feedbackKey(messageId));
    return value === 'up' || value === 'down' ? value : null;
  } catch {
    return null;
  }
}

function writeFeedback(messageId: string, value: 'up' | 'down' | null): void {
  try {
    if (value) globalThis.localStorage?.setItem(feedbackKey(messageId), value);
    else globalThis.localStorage?.removeItem(feedbackKey(messageId));
  } catch {
    /* storage is optional */
  }
}

export default function AssistantPanel({
  open,
  onClose,
  route,
  role,
  userId,
  onNavigate,
  onStartGuide,
  onBillCommand,
  onOptOut,
}: AssistantPanelProps) {
  const { t } = useTranslation();
  const [messages, setMessages] = useState<PanelMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastQuestion, setLastQuestion] = useState('');
  /** The files of the last question — Retry sends them again (a photo turn). */
  const [lastAttachments, setLastAttachments] = useState<PanelAttachment[]>([]);
  const [feedback, setFeedback] = useState<Record<string, 'up' | 'down'>>({});
  /** The proactive insights (opt-in — empty while the switch is off). */
  const [suggestions, setSuggestions] = useState<ProactiveSuggestion[]>([]);
  /** The files the user picked (they go with the next question). */
  const [attachments, setAttachments] = useState<PanelAttachment[]>([]);
  /** True while the microphone is recording. */
  const [recording, setRecording] = useState(false);
  /** The voice-only mode: the answer is read out and the mic is the main button. */
  const [voiceOnly, setVoiceOnly] = useState<boolean>(() => readVoiceOnly());
  /** What this computer can do with the voice. */
  const [voiceSupport, setVoiceSupport] = useState<'windows' | 'browser' | 'none'>('none');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<Element | null>(null);
  const recordingRef = useRef<VoiceRecording | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const browserRecognitionRef = useRef<BrowserSpeechRecognition | null>(null);

  const chips = useMemo(() => chipsForContext(role, route), [role, route]);

  // The proactive insights (opt-in). The main process decides whether there
  // are any at all — the switch is off by default.
  const loadSuggestions = useCallback(async () => {
    try {
      const rows = await window.api.assistant.proactive();
      setSuggestions(Array.isArray(rows) ? rows : []);
    } catch {
      setSuggestions([]);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void loadSuggestions();
    const timer = setInterval(() => void loadSuggestions(), 60000);
    return () => clearInterval(timer);
  }, [open, loadSuggestions]);

  // What this computer can do with the voice: the app's own offline
  // recogniser (the desktop app) or the browser's own (the web build).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const detect = async () => {
      const api = window.api?.assistant as
        | { transcribe?: unknown; voiceSupport?: () => Promise<{ stt?: string }> }
        | undefined;
      if (typeof api?.transcribe === 'function') {
        try {
          const support = await api.voiceSupport?.();
          if (!cancelled) setVoiceSupport(support?.stt === 'windows' ? 'windows' : 'none');
        } catch {
          if (!cancelled) setVoiceSupport('none');
        }
        return;
      }
      if (!cancelled) setVoiceSupport(browserSpeechRecognition() ? 'browser' : 'none');
    };
    void detect();
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Load the history when the panel opens; save it after every answer.
  useEffect(() => {
    if (!open) return;
    const stored = loadHistory(userId).map((m, i) => ({ ...m, id: `${i}-${m.at}` }));
    setMessages(stored);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, userId]);

  useEffect(() => {
    if (!open) return;
    previousFocus.current = document.activeElement;
    const timer = setTimeout(() => inputRef.current?.focus(), 30);
    return () => {
      clearTimeout(timer);
      const target = previousFocus.current as HTMLElement | null;
      if (target && typeof target.focus === 'function') target.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages, open]);

  const persist = useCallback(
    (next: PanelMessage[]) => {
      saveHistory(
        userId,
        next.map((m) => ({ role: m.role, text: m.text, at: m.at, source: m.source }))
      );
    },
    [userId]
  );

  const send = useCallback(
    async (question: string, withAttachments?: PanelAttachment[]) => {
      const text = question.trim();
      const files = withAttachments ?? attachments;
      if ((!text && files.length === 0) || busy) return;
      setBusy(true);
      setError(null);
      setLastQuestion(text);
      setLastAttachments(files);
      const asked: PanelMessage = {
        id: `u-${Date.now()}`,
        role: 'user',
        text,
        at: Date.now(),
        attachments: files.length ? files : undefined,
      };
      const history: AssistantMessage[] = messages
        .filter((m) => !m.pending)
        .map((m) => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text }));
      setMessages((prev) => [...prev, asked]);
      setInput('');
      setAttachments([]);
      // The messages this turn adds — they are persisted with the question.
      const added: PanelMessage[] = [];
      // The guide the assistant may have started (the overlay walks it).
      let startedGuide: string | undefined;
      try {
        // The UI-only fields (the id, the preview) never leave the renderer.
        const payload = files.map(({ id: _id, preview: _preview, ...rest }) => rest);
        const res = await window.api.assistant.send({
          message: text,
          route,
          history,
          attachments: payload,
        });
        startedGuide = res?.guide;
        if (!res.ok) {
          setError(res.failure?.message || t('assistant.error'));
          const failed: PanelMessage = {
            id: `a-${Date.now()}`,
            role: 'assistant',
            text: res.failure?.message || t('assistant.error'),
            at: Date.now(),
            failed: true,
          };
          added.push(failed);
          setMessages((prev) => [...prev, failed]);
        } else {
          const answer: PanelMessage = {
            id: `a-${Date.now()}`,
            role: 'assistant',
            text: res.text,
            at: Date.now(),
            source: res.source || undefined,
          };
          added.push(answer);
          setMessages((prev) => [...prev, answer]);
          // The voice-only mode reads the answer out by itself.
          if (voiceOnly) speak(res.text, detectLanguage(res.text));
        }
        // The proposed actions (a write tool) are shown as cards, never run.
        for (const pending of res.pendingActions || []) {
          const card: PanelMessage = {
            id: `p-${Date.now()}-${pending.tool}`,
            role: 'assistant',
            text: t('assistant.actionProposed'),
            at: Date.now(),
            pending,
          };
          added.push(card);
          setMessages((prev) => [...prev, card]);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
        persist([...messages, asked, ...added]);
      }
      // The assistant may have started a guide — the overlay walks the user
      // through it on the real screen.
      if (startedGuide) onStartGuide?.(startedGuide);
    },
    [busy, messages, route, t, persist, onStartGuide, attachments, voiceOnly]
  );

  const stop = useCallback(async () => {
    try {
      await window.api.assistant.cancel();
    } catch {
      /* the turn may already be over */
    }
    setBusy(false);
  }, []);

  /**
   * Stop listening and put the words into the question box.
   *
   * The desktop app records the microphone and hands the audio to its own
   * OFFLINE recogniser; the web build uses the browser's own recogniser. The
   * words always land in the input box first, so the user can read them and
   * change them before the question is sent.
   */
  const stopListening = useCallback(async () => {
    const browserRecognition = browserRecognitionRef.current;
    if (browserRecognition) {
      browserRecognitionRef.current = null;
      try {
        browserRecognition.stop();
      } catch {
        /* the recogniser may already be stopped */
      }
      setRecording(false);
      return;
    }
    const active = recordingRef.current;
    recordingRef.current = null;
    setRecording(false);
    if (!active) return;
    try {
      const { base64 } = await active.stop();
      const result = await window.api.assistant.transcribe(base64);
      if (result?.ok && result.text?.trim()) {
        const heard = result.text.trim();
        // In VOICE-ONLY mode the user is talking, not typing: the question is
        // sent as soon as it is heard, so the answer comes back spoken.
        if (voiceOnly) {
          setInput('');
          void send(heard);
        } else {
          setInput((prev) => (prev ? `${prev} ${heard}` : heard));
          inputRef.current?.focus();
        }
      } else {
        setError(result?.message || t('assistant.voiceNotHeard'));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t('assistant.voiceUnavailable'));
    }
  }, [t, send, voiceOnly]);

  /** Start listening — the microphone, or the browser's own recogniser. */
  const listen = useCallback(async () => {
    if (recording) {
      await stopListening();
      return;
    }
    setError(null);
    const Recognition = browserSpeechRecognition();
    if (voiceSupport === 'browser' && Recognition) {
      try {
        const recognition = new Recognition();
        recognition.lang = 'en-US';
        recognition.interimResults = false;
        recognition.continuous = false;
        recognition.onresult = (event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => {
          const transcript = String(event.results?.[0]?.[0]?.transcript ?? '').trim();
          if (transcript) {
            // Voice-only: send what was heard (the answer is read out); the
            // normal mode only fills the box so the user can edit the words.
            if (voiceOnly) {
              setInput('');
              void send(transcript);
            } else {
              setInput((prev) => (prev ? `${prev} ${transcript}` : transcript));
              inputRef.current?.focus();
            }
          }
          setRecording(false);
        };
        recognition.onerror = () => {
          setRecording(false);
          setError(t('assistant.voiceNotHeard'));
        };
        recognition.onend = () => setRecording(false);
        browserRecognitionRef.current = recognition;
        recognition.start();
        setRecording(true);
      } catch {
        setError(t('assistant.voiceUnavailable'));
      }
      return;
    }
    if (!recordingSupported()) {
      setError(t('assistant.voiceUnavailable'));
      return;
    }
    try {
      recordingRef.current = await startVoiceRecording();
      setRecording(true);
    } catch {
      setError(t('assistant.voiceUnavailable'));
    }
  }, [recording, stopListening, t, voiceSupport, send, voiceOnly]);

  /** Take the files the user picked (a photo the model can see, or a text file). */
  const attachFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || !files.length) return;
      const picked: PanelAttachment[] = [];
      for (const file of Array.from(files)) {
        const kind = attachmentKindFor(file.name, file.type);
        if (!kind) {
          setError(t('assistant.fileNotSupported'));
          continue;
        }
        if (file.size > maxBytesFor(kind)) {
          setError(t('assistant.fileTooBig'));
          continue;
        }
        try {
          if (kind === 'image') {
            const dataUrl = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(String(reader.result || ''));
              reader.onerror = () => reject(new Error('read failed'));
              reader.readAsDataURL(file);
            });
            const { mediaType, base64 } = splitDataUrl(dataUrl);
            picked.push({
              id: `att-${Date.now()}-${picked.length}`,
              kind,
              mediaType: mediaType || file.type || 'image/png',
              name: cleanAttachmentName(file.name),
              data: base64,
              preview: dataUrl,
            });
            continue;
          }
          const text = await file.text();
          picked.push({
            id: `att-${Date.now()}-${picked.length}`,
            kind,
            mediaType: file.type || 'text/plain',
            name: cleanAttachmentName(file.name),
            data: textToBase64(text),
          });
        } catch {
          setError(t('assistant.fileNotSupported'));
        }
      }
      if (picked.length) {
        setAttachments((prev) => {
          const merged = [...prev, ...picked];
          if (merged.length > MAX_ATTACHMENTS) {
            setError(t('assistant.fileTooMany'));
            return merged.slice(0, MAX_ATTACHMENTS);
          }
          return merged;
        });
      }
    },
    [t]
  );

  /** Read an answer out loud (the button on every answer). */
  const say = useCallback(
    (message: PanelMessage) => {
      const text = speakableText(message.text);
      if (!text) return;
      if (!speechSupported()) {
        setError(t('assistant.voiceUnavailable'));
        return;
      }
      speak(message.text, detectLanguage(message.text));
    },
    [t]
  );

  /** The voice-only mode — the user's own choice, kept on this computer. */
  const toggleVoiceOnly = useCallback(() => {
    setVoiceOnly((prev) => {
      const next = !prev;
      writeVoiceOnly(next);
      if (!next) stopSpeaking();
      return next;
    });
  }, []);

  const copy = useCallback(async (message: PanelMessage) => {
    try {
      await navigator.clipboard.writeText(sanitizePlainText(message.text));
    } catch {
      /* the clipboard may be blocked */
    }
  }, []);

  const rate = useCallback((message: PanelMessage, value: 'up' | 'down') => {
    const next = feedback[message.id] === value ? null : value;
    writeFeedback(message.id, next);
    setFeedback((prev) => {
      const copy = { ...prev };
      if (next) copy[message.id] = next;
      else delete copy[message.id];
      return copy;
    });
  }, [feedback]);

  const clear = useCallback(() => {
    clearHistory(userId);
    setMessages([]);
  }, [userId]);

  /**
   * Confirm or cancel a waiting action.
   *
   * The action itself runs in the main process (through the very same service
   * the normal UI uses) and only when the owner confirms it.
   */
  const settle = useCallback(
    async (message: PanelMessage, what: 'confirm' | 'cancel') => {
      const id = message.pending?.id;
      if (!id) return;
      setBusy(true);
      setError(null);
      try {
        const res =
          what === 'confirm'
            ? await window.api.assistant.pendingConfirm(id)
            : await window.api.assistant.pendingCancel(id);
        const status = res.ok
          ? what === 'confirm'
            ? 'confirmed'
            : 'cancelled'
          : 'failed';
        setMessages((prev) =>
          prev.map((m) =>
            m.id === message.id && m.pending
              ? { ...m, pending: { ...m.pending, status: status as any } }
              : m
          )
        );
        if (!res.ok && res.message) setError(res.message);
        // A confirmed BILLING action is applied by the Billing screen (the bill
        // lives there): the panel only hands the command over.
        if (what === 'confirm' && res.ok) {
          const command = billCommandFromResult(
            (res as { result?: unknown }).result
          );
          if (command) onBillCommand?.(command);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [onBillCommand]
  );

  if (!open) return null;

  return (
    <aside
      className="assistant-panel"
      role="dialog"
      aria-label={t('assistant.title')}
      onKeyDown={(e) => {
        // Esc closes the panel only when it is the topmost thing open.
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="assistant-panel-head">
        <h2 className="assistant-panel-title">{t('assistant.title')}</h2>
        <div className="assistant-panel-head-actions">
          <button
            type="button"
            className={`btn btn-sm${voiceOnly ? ' active' : ''}`}
            aria-pressed={voiceOnly}
            onClick={toggleVoiceOnly}
            title={t('assistant.voiceOnlyHint')}
          >
            {t('assistant.voiceOnly')}
          </button>
          <button type="button" className="btn btn-sm" onClick={clear} title={t('assistant.clearHistory')}>
            {t('assistant.clearHistory')}
          </button>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => onOptOut?.()}
            title={t('assistant.optOut')}
          >
            {t('assistant.optOut')}
          </button>
          <button type="button" className="assistant-panel-close" onClick={onClose} aria-label={t('assistant.close')}>
            ×
          </button>
        </div>
      </div>

      {suggestions.length > 0 && (
        <div className="assistant-suggestions">
          <div className="muted small">{t('assistant.proactiveTitle')}</div>
          {suggestions.map((suggestion) => (
            <button
              key={suggestion.id}
              type="button"
              className={`assistant-suggestion assistant-suggestion-${suggestion.severity}`}
              onClick={() => void send(suggestion.prompt)}
            >
              <span className="assistant-suggestion-title">{t(suggestion.titleKey)}</span>
              <span className="muted small">
                {t(suggestion.messageKey, {
                  count: suggestion.values.count ?? 0,
                  amount: suggestion.values.amount !== undefined ? formatMoney(suggestion.values.amount) : '',
                })}
              </span>
            </button>
          ))}
        </div>
      )}

      <div className="assistant-messages" ref={listRef} aria-live="polite" aria-atomic="false">
        {messages.length === 0 && (
          <div className="assistant-empty muted small">{t('assistant.empty')}</div>
        )}
        {messages.map((message) => (
          <div key={message.id} className={`assistant-message assistant-message-${message.role}`}>
            {message.attachments && message.attachments.length > 0 && (
              <div className="assistant-message-attachments">
                {message.attachments.map((file) => (
                  <span key={file.id} className="assistant-attachment assistant-attachment-sent">
                    {file.preview ? (
                      <img src={file.preview} alt={file.name} className="assistant-attachment-thumb" />
                    ) : (
                      <span className="assistant-attachment-icon" aria-hidden="true">📄</span>
                    )}
                    <span className="assistant-attachment-name">{file.name}</span>
                  </span>
                ))}
              </div>
            )}
            <div className="assistant-message-body">
              {message.role === 'assistant'
                ? sanitizeMessage(message.text).map((block, index) => (
                    <p key={index} className={`assistant-block assistant-block-${block.type}`}>
                      {block.runs.map((run, runIndex) =>
                        run.code ? (
                          <code key={runIndex}>{run.text}</code>
                        ) : run.bold ? (
                          <strong key={runIndex}>{run.text}</strong>
                        ) : run.italic ? (
                          <em key={runIndex}>{run.text}</em>
                        ) : (
                          <span key={runIndex}>{run.text}</span>
                        )
                      )}
                    </p>
                  ))
                : <p className="assistant-block">{message.text}</p>}
            </div>
            {message.source && <div className="assistant-source muted small">{message.source}</div>}
            {message.pending && (
              <div className="assistant-action-card">
                <div className="assistant-action-title">{t('assistant.actionTitle')}</div>
                <div className="muted small">
                  {message.pending.preview || message.pending.tool}
                </div>
                {message.pending.details && message.pending.details.length > 0 && (
                  <table className="assistant-action-details">
                    <tbody>
                      {message.pending.details.map((d) => (
                        <tr key={d.label}>
                          <td className="muted small">{d.label}</td>
                          <td className="small">{d.before !== undefined && d.before !== null ? String(d.before) : '—'}</td>
                          <td className="small">{d.after !== undefined && d.after !== null ? String(d.after) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {message.pending.status === 'pending' && message.pending.id ? (
                  <div className="assistant-action-buttons">
                    <button
                      type="button"
                      className="btn btn-xs btn-primary"
                      onClick={() => void settle(message, 'confirm')}
                    >
                      {t('assistant.actionConfirm')}
                    </button>
                    <button
                      type="button"
                      className="btn btn-xs"
                      onClick={() => void settle(message, 'cancel')}
                    >
                      {t('assistant.actionCancel')}
                    </button>
                  </div>
                ) : (
                  <div className="muted small">{t(`assistant.action_${message.pending.status || 'pending'}`)}</div>
                )}
              </div>
            )}
            {message.role === 'assistant' && !message.pending && (
              <div className="assistant-message-actions">
                <button type="button" className="btn btn-xs" onClick={() => void copy(message)}>{t('assistant.copy')}</button>
                {speechSupported() && (
                  <button
                    type="button"
                    className="btn btn-xs assistant-speak"
                    onClick={() => say(message)}
                    title={t('assistant.speak')}
                  >
                    {t('assistant.speak')}
                  </button>
                )}
                <button
                  type="button"
                  className={`btn btn-xs${feedback[message.id] === 'up' ? ' active' : ''}`}
                  aria-pressed={feedback[message.id] === 'up'}
                  onClick={() => rate(message, 'up')}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className={`btn btn-xs${feedback[message.id] === 'down' ? ' active' : ''}`}
                  aria-pressed={feedback[message.id] === 'down'}
                  onClick={() => rate(message, 'down')}
                >
                  ↓
                </button>
              </div>
            )}
          </div>
        ))}
        {busy && (
          <div className="assistant-typing muted small" aria-live="polite">
            {t('assistant.typing')}
          </div>
        )}
        {error && <div className="notice error" onClick={() => setError(null)}>{error}</div>}
      </div>

      {chips.length > 0 && (
        <div className="assistant-chips" role="list">
          {chips.map((chip) => (
            <button
              key={chip.id}
              type="button"
              className="assistant-chip"
              role="listitem"
              onClick={() => void send(chip.prompt)}
            >
              {t(chip.labelKey)}
            </button>
          ))}
        </div>
      )}

      <div className="assistant-composer">
        {attachments.length > 0 && (
          <div className="assistant-attachments" role="list">
            {attachments.map((file) => (
              <span key={file.id} className="assistant-attachment" role="listitem">
                {file.preview ? (
                  <img src={file.preview} alt={file.name} className="assistant-attachment-thumb" />
                ) : (
                  <span className="assistant-attachment-icon" aria-hidden="true">📄</span>
                )}
                <span className="assistant-attachment-name">{file.name}</span>
                <button
                  type="button"
                  className="assistant-attachment-remove"
                  aria-label={`${t('assistant.removeAttachment')} ${file.name}`}
                  onClick={() => setAttachments((prev) => prev.filter((f) => f.id !== file.id))}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        {recording && (
          <div className="assistant-listening" role="status">
            <span className="assistant-listening-dot" aria-hidden="true" />
            {t('assistant.voiceListening')}
          </div>
        )}
        <div className="assistant-input-row">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,.txt,.csv,.json,.md,.log,.xml,.yml,.yaml,.ini"
            multiple
            className="assistant-file-input"
            aria-label={t('assistant.attach')}
            onChange={(e) => {
              void attachFiles(e.target.files);
              e.target.value = '';
            }}
          />
          <button
            type="button"
            className="assistant-icon-btn"
            onClick={() => fileInputRef.current?.click()}
            title={t('assistant.attach')}
            aria-label={t('assistant.attach')}
          >
            📎
          </button>
          <textarea
            ref={inputRef}
            className="assistant-input"
            value={input}
            rows={2}
            placeholder={t('assistant.placeholder')}
            // The placeholder alone is not an accessible name — a screen reader
            // must be able to say what this box is.
            aria-label={t('assistant.placeholder')}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              // Enter sends, Shift+Enter makes a new line. The scanner's keys are
              // untouched: this handler only sees the panel's own textarea.
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send(input);
              }
            }}
          />
          {voiceSupport !== 'none' && (
            <button
              type="button"
              className={`assistant-icon-btn assistant-mic${recording ? ' assistant-mic-active' : ''}`}
              onClick={() => void listen()}
              title={recording ? t('assistant.voiceStop') : t('assistant.voiceInput')}
              aria-label={recording ? t('assistant.voiceStop') : t('assistant.voiceInput')}
              aria-pressed={recording}
            >
              🎤
            </button>
          )}
        </div>
        <div className="assistant-composer-actions">
          {busy ? (
            <button type="button" className="btn btn-primary" onClick={() => void stop()}>{t('assistant.stop')}</button>
          ) : (
            <button
              type="button"
              className="btn btn-primary"
              disabled={!input.trim() && attachments.length === 0}
              onClick={() => void send(input)}
            >
              {t('assistant.send')}
            </button>
          )}
          {(lastQuestion || lastAttachments.length > 0) && !busy && (
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => void send(lastQuestion, lastAttachments)}
            >
              {t('assistant.retry')}
            </button>
          )}
          <span className="muted small assistant-composer-hint">{t('assistant.hint')}</span>
        </div>
      </div>
    </aside>
  );
}
