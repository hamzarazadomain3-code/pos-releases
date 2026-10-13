import { useState } from 'react';
import LabelStudio from './LabelStudio';
import BarcodeGenerator from './BarcodeGenerator';

export type LabelsMode = 'quick' | 'designer';

/**
 * Single entry point for label printing.
 *
 * The old standalone "Barcode Labels" page and the "Label Studio" designer are
 * the same job at two levels of control, so they now live behind one sidebar
 * entry and a mode switch:
 *   - Quick Labels → pick products, choose size/copies, preview, print
 *                    (the former Barcode Labels page)
 *   - Designer     → templates, layout, printer offsets, calibration
 *                    (the former Label Studio)
 *
 * The legacy `barcode` nav key renders this page in Quick mode, so existing
 * shortcuts, deep links and permissions keep working.
 */
export default function Labels({ initialMode = 'designer' }: { initialMode?: LabelsMode }) {
  const [mode, setMode] = useState<LabelsMode>(initialMode);

  return (
    <>
      <div className="labels-mode-bar" data-labels-mode={mode}>
        <div className="labels-mode-switch" role="group" aria-label="Label mode">
          <button
            type="button"
            className={`labels-mode-btn${mode === 'quick' ? ' active' : ''}`}
            aria-pressed={mode === 'quick'}
            onClick={() => setMode('quick')}
          >
            Quick Labels
          </button>
          <button
            type="button"
            className={`labels-mode-btn${mode === 'designer' ? ' active' : ''}`}
            aria-pressed={mode === 'designer'}
            onClick={() => setMode('designer')}
          >
            Designer
          </button>
        </div>
        <span className="labels-mode-hint muted small">
          {mode === 'quick'
            ? 'Pick products and print their labels straight away.'
            : 'Design templates, then print a batch with your layout.'}
        </span>
      </div>
      {mode === 'quick' ? <BarcodeGenerator /> : <LabelStudio />}
    </>
  );
}
