import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  currentStep,
  guideById,
  guideReducer,
  guideTitle,
  stepCount,
  stepText,
  INITIAL_GUIDE_STATE,
  type GuideState,
} from '../../../shared/assistant/guides';

/**
 * The guide overlay — the "dikha do" mode.
 *
 * It walks the user through the steps of a guide and HIGHLIGHTS the control
 * of the current step (the `data-guide-id` anchor). It never clicks for the
 * user: the shop owner does the work.
 *
 * The step machine is the pure reducer in `shared/assistant/guides.ts`, so
 * the overlay and the test can never disagree about where the guide is.
 */

export interface GuideOverlayProps {
  /** The guide that is running (null = no guide). */
  guideId: string | null;
  /** Called when the guide is closed. */
  onClose: () => void;
  /** Called when the guide wants to move the user to another page. */
  onNavigate?: (route: string) => void;
  /** The page the user is on (the overlay offers to move when it differs). */
  route?: string | null;
}

/** The class the overlay puts on the control it points at. */
export const GUIDE_HIGHLIGHT_CLASS = 'guide-highlight';

export default function GuideOverlay({ guideId, onClose, onNavigate, route }: GuideOverlayProps) {
  const { i18n, t } = useTranslation();
  const [state, setState] = useState<GuideState>(INITIAL_GUIDE_STATE);
  /** True when the control of the current step is not on the screen. */
  const [missingTarget, setMissingTarget] = useState(false);

  const language = i18n.language === 'ur' ? 'ur' : 'en';

  // Start the guide whenever a new one is asked for.
  useEffect(() => {
    if (!guideId) {
      setState(INITIAL_GUIDE_STATE);
      return;
    }
    setState((prev) => guideReducer(prev, { type: 'start', guideId }));
  }, [guideId]);

  const guide = useMemo(() => (state.guideId ? guideById(state.guideId) : null), [state.guideId]);
  const step = currentStep(state);
  const total = stepCount(state);

  // Highlight the control of the current step.
  const highlighted = useRef<Element | null>(null);
  useEffect(() => {
    const previous = highlighted.current;
    if (previous) previous.classList.remove(GUIDE_HIGHLIGHT_CLASS);
    highlighted.current = null;
    setMissingTarget(false);
    if (!step) return;
    const target = document.querySelector(`[data-guide-id="${step.anchor}"]`);
    if (target instanceof HTMLElement) {
      target.classList.add(GUIDE_HIGHLIGHT_CLASS);
      highlighted.current = target;
      try {
        target.scrollIntoView({ block: 'center', behavior: 'smooth' });
      } catch {
        target.scrollIntoView();
      }
    } else {
      setMissingTarget(true);
    }
  }, [step?.id, step?.anchor]);

  // The guide must never trap the user: Esc closes it.
  useEffect(() => {
    if (!guideId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [guideId, onClose]);

  const next = useCallback(() => setState((s) => guideReducer(s, { type: 'next' })), []);
  const prev = useCallback(() => setState((s) => guideReducer(s, { type: 'prev' })), []);

  if (!guideId || !guide) return null;

  const text = step ? stepText(step, language) : null;
  const needsNavigation = !!guide.route && route !== guide.route;

  return (
    <div className="guide-overlay" role="dialog" aria-label={guideTitle(guide, language)}>
      <div className="guide-card">
        <div className="guide-head">
          <h2 className="guide-title">{guideTitle(guide, language)}</h2>
          <span className="guide-count muted small">
            {state.done ? '—' : `${state.stepIndex + 1} / ${total}`}
          </span>
          <button
            type="button"
            className="guide-close"
            onClick={onClose}
            aria-label={t('assistant.guide.close')}
          >
            ×
          </button>
        </div>

        {state.done ? (
          <div className="guide-body">
            <p className="muted">{t('assistant.guide.done')}</p>
          </div>
        ) : (
          <div className="guide-body">
            <h3 className="guide-step-title">{text?.title}</h3>
            <p className="guide-step-text">{text?.body}</p>
            {needsNavigation && onNavigate && (
              <button
                type="button"
                className="btn btn-sm guide-open-page"
                onClick={() => onNavigate(guide.route)}
              >
                {t('assistant.guide.openPage')}
              </button>
            )}
            {missingTarget && !needsNavigation && (
              <p className="muted small guide-note">{t('assistant.guide.missingTarget')}</p>
            )}
          </div>
        )}

        <div className="guide-actions">
          <button
            type="button"
            className="btn btn-sm"
            onClick={prev}
            disabled={state.stepIndex === 0}
          >
            {t('assistant.guide.back')}
          </button>
          <button
            type="button"
            className="btn btn-sm btn-primary"
            onClick={state.done ? onClose : next}
          >
            {state.done ? t('assistant.guide.close') : t('assistant.guide.next')}
          </button>
        </div>
      </div>
    </div>
  );
}
