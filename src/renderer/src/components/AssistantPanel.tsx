import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AssistantMessage, AssistantPendingAction } from '../../../shared/assistant/types';
import { sanitizeMessage, sanitizePlainText } from '../../../shared/assistant/sanitize';
import { chipsForContext } from '../../../shared/assistant/chips';
import { loadHistory, saveHistory, clearHistory, type StoredAssistantMessage } from '../../../shared/assistant/history';
import { detectLanguage } from '../../../shared/assistant/language';
import { formatMoney } from '../utils/currency';

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
}

interface PanelMessage extends StoredAssistantMessage {
  id: string;
  /** The tool the answer came from (the source line under the answer). */
  source?: string;
  /** A pending action the assistant proposed. */
  pending?: AssistantPendingAction;
  failed?: boolean;
}

const FEEDBACK_KEY = 'assistant_feedback';

function feedbackKey(messageId: string): string {
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
}: AssistantPanelProps) {
  const { t } = useTranslation();
  const [messages, setMessages] = useState<PanelMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastQuestion, setLastQuestion] = useState('');
  const [feedback, setFeedback] = useState<Record<string, 'up' | 'down'>>({});
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<Element | null>(null);

  const chips = useMemo(() => chipsForContext(role, route), [role, route]);

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
    async (question: string) => {
      const text = question.trim();
      if (!text || busy) return;
      setBusy(true);
      setError(null);
      setLastQuestion(text);
      const asked: PanelMessage = {
        id: `u-${Date.now()}`,
        role: 'user',
        text,
        at: Date.now(),
      };
      const history: AssistantMessage[] = messages
        .filter((m) => !m.pending)
        .map((m) => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text }));
      setMessages((prev) => [...prev, asked]);
      setInput('');
      // The messages this turn adds — they are persisted with the question.
      const added: PanelMessage[] = [];
      // The guide the assistant may have started (the overlay walks it).
      let startedGuide: string | undefined;
      try {
        const res = await window.api.assistant.send({ message: text, route, history });
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
    [busy, messages, route, t, persist, onStartGuide]
  );

  const stop = useCallback(async () => {
    try {
      await window.api.assistant.cancel();
    } catch {
      /* the turn may already be over */
    }
    setBusy(false);
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
          <button type="button" className="btn btn-sm" onClick={clear} title={t('assistant.clearHistory')}>
            {t('assistant.clearHistory')}
          </button>
          <button type="button" className="assistant-panel-close" onClick={onClose} aria-label={t('assistant.close')}>
            ×
          </button>
        </div>
      </div>

      <div className="assistant-messages" ref={listRef} aria-live="polite" aria-atomic="false">
        {messages.length === 0 && (
          <div className="assistant-empty muted small">{t('assistant.empty')}</div>
        )}
        {messages.map((message) => (
          <div key={message.id} className={`assistant-message assistant-message-${message.role}`}>
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
                <div className="muted small">{message.pending.tool}</div>
                <pre className="assistant-action-args">{JSON.stringify(message.pending.args, null, 1)}</pre>
                <div className="muted small">{t('assistant.actionWaiting')}</div>
              </div>
            )}
            {message.role === 'assistant' && !message.pending && (
              <div className="assistant-message-actions">
                <button type="button" className="btn btn-xs" onClick={() => void copy(message)}>{t('assistant.copy')}</button>
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
        <textarea
          ref={inputRef}
          className="assistant-input"
          value={input}
          rows={2}
          placeholder={t('assistant.placeholder')}
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
        <div className="assistant-composer-actions">
          {busy ? (
            <button type="button" className="btn btn-primary" onClick={() => void stop()}>{t('assistant.stop')}</button>
          ) : (
            <button type="button" className="btn btn-primary" disabled={!input.trim()} onClick={() => void send(input)}>
              {t('assistant.send')}
            </button>
          )}
          {lastQuestion && !busy && (
            <button type="button" className="btn btn-sm" onClick={() => void send(lastQuestion)}>{t('assistant.retry')}</button>
          )}
          <span className="muted small assistant-composer-hint">{t('assistant.hint')}</span>
        </div>
      </div>
    </aside>
  );
}
