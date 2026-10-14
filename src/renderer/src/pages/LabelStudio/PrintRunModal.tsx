import { useState } from 'react';
import { Modal } from '@components/Modal';
import { KeyboardInput } from '@components/KeyboardInput';
import type { LabelRunOptions } from './types';

interface Props {
  onClose: () => void;
  onConfirm: (run: LabelRunOptions) => void;
  initial?: LabelRunOptions;
  rollCols: number;
  labelLayout: 'roll' | 'sheet';
  labelCount: number;
  busy?: boolean;
}

/**
 * Print Run dialog. Every value here overrides the template/product for ONE run
 * only, so a shop can print "Mfg today / Exp 02-Jan-2027 / Rs 100" without
 * editing the product or the saved template.
 */
export function PrintRunModal({ onClose, onConfirm, initial, rollCols, labelLayout, labelCount, busy }: Props) {
  const [mfgDate, setMfgDate] = useState<string>(initial?.mfgDate || '');
  const [expOverride, setExpOverride] = useState<string>(initial?.expOverride || '');
  const [priceSource, setPriceSource] = useState<'retail' | 'wholesale' | 'custom'>(initial?.priceSource || 'retail');
  const [customPrice, setCustomPrice] = useState<number>(initial?.customPrice ?? 0);
  const [weight, setWeight] = useState<string>(initial?.weight || '');
  const [startCol, setStartCol] = useState<number>(initial?.startCol ?? 1);
  const [cols, setCols] = useState<number>(initial?.rollCols ?? rollCols ?? 1);
  const [barcodeDpi, setBarcodeDpi] = useState<number>(initial?.barcodeDpi ?? 203);

  const isRoll = labelLayout === 'roll';

  const confirm = () => {
    onConfirm({
      mfgDate: mfgDate.trim() || null,
      expOverride: expOverride.trim() || null,
      priceSource,
      customPrice: priceSource === 'custom' ? Number(customPrice) || 0 : null,
      weight: weight.trim() || null,
      startCol: isRoll ? Math.max(1, Math.min(cols, Math.floor(startCol) || 1)) : 1,
      barcodeDpi,
      rollCols: isRoll ? cols : 1,
    });
  };

  return (
    <Modal onClose={onClose} title="Print Run" className="modal-md" showClose>
      <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <p style={{ margin: 0, color: '#555', fontSize: '13px' }}>
          These values apply to <b>{labelCount}</b> label{labelCount === 1 ? '' : 's'} for this print only.
          Leave a field blank to use each product's own value.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
          <label className="field"><span>Mfg date (all)</span>
            <input type="date" className="field-input" value={mfgDate} onChange={e => setMfgDate(e.target.value)} />
          </label>
          <label className="field"><span>Expiry (all)</span>
            <input type="date" className="field-input" value={expOverride} onChange={e => setExpOverride(e.target.value)} />
          </label>
          <label className="field"><span>Price source</span>
            <select className="field-select" value={priceSource} onChange={e => setPriceSource(e.target.value as any)}>
              <option value="retail">Retail price</option>
              <option value="wholesale">Wholesale price</option>
              <option value="custom">Custom price…</option>
            </select>
          </label>
          <label className="field"><span>Custom price</span>
            <KeyboardInput
              type="text"
              decimals
              value={customPrice}
              disabled={priceSource !== 'custom'}
              onChange={e => setCustomPrice(parseFloat(e.target.value) || 0)}
            />
          </label>
          <label className="field"><span>Weight (all, e.g. 100g)</span>
            <input type="text" className="field-input" value={weight} onChange={e => setWeight(e.target.value)} placeholder="use product" />
          </label>
          <label className="field"><span>Barcode DPI</span>
            <select className="field-select" value={barcodeDpi} onChange={e => setBarcodeDpi(parseInt(e.target.value) || 203)}>
              <option value={203}>203 dpi</option>
              <option value={300}>300 dpi</option>
            </select>
          </label>
          {isRoll && (
            <>
              <label className="field"><span>Columns across</span>
                <select className="field-select" value={cols} onChange={e => setCols(parseInt(e.target.value) || 1)}>
                  <option value={1}>1 across</option>
                  <option value={2}>2 across</option>
                  <option value={3}>3 across</option>
                </select>
              </label>
              <label className="field"><span>Start at column</span>
                <KeyboardInput
                  type="text"
                  decimals={false}
                  value={startCol}
                  onChange={e => setStartCol(Math.max(1, Math.min(cols, parseInt(e.target.value) || 1)))}
                />
              </label>
            </>
          )}
        </div>

        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '4px' }}>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={confirm} disabled={busy}>
            {busy ? 'Printing…' : 'Print'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
