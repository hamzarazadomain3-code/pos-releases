import type { LabelTemplate, LabelElement } from './types';
import { resolveSizeSpec } from './types';

interface Props {
  template: LabelTemplate;
  /** Rendered width in px (height follows the label aspect ratio). */
  width?: number;
  className?: string;
}

/**
 * Tiny non-interactive drawing of a template used in the Template Manager and
 * the template picker. It is intentionally schematic — bars for the barcode,
 * lines for text — so it stays cheap and never rasterises a real barcode.
 */
export function LabelThumbnail({ template, width = 120, className }: Props) {
  const spec = resolveSizeSpec(template);
  const w = spec.w || 38;
  const h = spec.h || 25;
  const border = template.options?.border === true;
  const cols = template.layout === 'sheet' ? 1 : Math.min(3, Math.max(1, template.rollCols || 1));
  const shownW = cols > 1 ? cols * w + (cols - 1) * (spec.gap ?? 0) : w;
  const heightPx = Math.max(24, Math.round((width * (h / shownW)) * (cols > 1 ? cols : 1)));
  const scale = width / shownW;

  const drawElement = (el: LabelElement, key: string) => {
    if (!el.visible) return null;
    const x = el.x * scale;
    const y = el.y * scale;
    const ew = Math.max(1, el.w * scale);
    const eh = Math.max(1, el.h * scale);
    if (el.type === 'barcode' || el.type === 'qr') {
      const bars = Math.max(6, Math.round(ew / 1.6));
      return (
        <g key={key}>
          {Array.from({ length: bars }).map((_, i) => (
            <rect key={i} x={x + (i * ew) / bars} y={y} width={Math.max(0.5, ew / bars / 2)} height={eh} fill="#000" />
          ))}
        </g>
      );
    }
    if (el.type === 'rect' || el.type === 'border') {
      return <rect key={key} x={x} y={y} width={ew} height={eh} fill="none" stroke="#000" strokeWidth={0.7} />;
    }
    if (el.type === 'line') {
      return <rect key={key} x={x} y={y + eh - 0.6} width={ew} height={0.6} fill="#000" />;
    }
    if (el.type === 'image') {
      return <rect key={key} x={x} y={y} width={ew} height={eh} fill="#d1d5db" stroke="#9ca3af" strokeWidth={0.5} />;
    }
    // Text-like: draw a couple of content lines proportional to the box.
    const isPrice = el.type === 'price';
    const lines = Math.max(1, Math.min(3, Math.round(eh / 3)));
    return (
      <g key={key}>
        {Array.from({ length: lines }).map((_, i) => (
          <rect
            key={i}
            x={x}
            y={y + 1 + i * (eh / Math.max(1, lines))}
            width={ew * (el.style?.align === 'center' ? 0.7 : i === 0 ? 0.95 : 0.6)}
            height={Math.max(0.7, Math.min(1.4, eh / (lines + 1)))}
            rx={0.3}
            fill={el.type === 'price' ? '#111827' : '#4b5563'}
          />
        ))}
      </g>
    );
  };

  return (
    <svg
      className={className}
      width={width}
      height={heightPx}
      viewBox={`0 0 ${shownW} ${h}`}
      preserveAspectRatio="xMidYMid meet"
      style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 3, display: 'block' }}
    >
      {Array.from({ length: cols }).map((_, c) => {
        const ox = c * (w + (spec.gap ?? 0));
        return (
          <g key={c} transform={`translate(${ox},0)`}>
            <rect x={0} y={0} width={w} height={h} fill="#fff" stroke="#f1f5f9" strokeWidth={0.4} />
            {border && <rect x={0.3} y={0.3} width={w - 0.6} height={h - 0.6} fill="none" stroke="#000" strokeWidth={0.5} />}
            {template.elements.map((el, i) => drawElement(el, `${c}-${i}`))}
          </g>
        );
      })}
    </svg>
  );
}
