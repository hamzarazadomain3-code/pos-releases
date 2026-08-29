import { useEffect, useRef, useState, useCallback } from 'react';

interface Props {
  imageSrc: string;
  onApply: (croppedDataUrl: string) => void;
  onClose: () => void;
}

type AspectRatio = 'free' | '16:9' | '4:3' | '1:1';

const ASPECT_RATIOS: { label: string; value: AspectRatio; ratio?: number }[] = [
  { label: 'Free', value: 'free' },
  { label: '16:9', value: '16:9', ratio: 16 / 9 },
  { label: '4:3', value: '4:3', ratio: 4 / 3 },
  { label: '1:1', value: '1:1', ratio: 1 },
];

export default function WallpaperEditor({ imageSrc, onApply, onClose }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [aspect, setAspect] = useState<AspectRatio>('free');
  const [crop, setCrop] = useState({ x: 50, y: 50, w: 400, h: 300 });
  const [dragging, setDragging] = useState(false);
  const [dragType, setDragType] = useState<'move' | 'nw' | 'ne' | 'sw' | 'se' | null>(null);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [cropStart, setCropStart] = useState(crop);
  const [zoom, setZoom] = useState(1);
  const [loaded, setLoaded] = useState(false);
  const [canvasSize, setCanvasSize] = useState({ w: 700, h: 450 });

  const imgNat = useRef({ w: 0, h: 0 });

  useEffect(() => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      imgRef.current = img;
      imgNat.current = { w: img.naturalWidth, h: img.naturalHeight };
      const scale = Math.min(canvasSize.w / img.naturalWidth, canvasSize.h / img.naturalHeight);
      const w = Math.min(img.naturalWidth * scale, canvasSize.w);
      const h = Math.min(img.naturalHeight * scale, canvasSize.h);
      const x = (canvasSize.w - w) / 2;
      const y = (canvasSize.h - h) / 2;
      setCrop({ x, y, w, h });
      setLoaded(true);
    };
    img.src = imageSrc;
  }, [imageSrc, canvasSize]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img || !loaded) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = canvasSize.w;
    canvas.height = canvasSize.h;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const scale = Math.min(canvasSize.w / img.naturalWidth, canvasSize.h / img.naturalHeight) * zoom;
    const imgW = img.naturalWidth * scale;
    const imgH = img.naturalHeight * scale;
    const imgX = (canvasSize.w - imgW) / 2;
    const imgY = (canvasSize.h - imgH) / 2;

    ctx.drawImage(img, imgX, imgY, imgW, imgH);

    // Dim area outside crop
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.clearRect(crop.x, crop.y, crop.w, crop.h);
    ctx.drawImage(img, imgX, imgY, imgW, imgH);

    // Crop border
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(crop.x, crop.y, crop.w, crop.h);
    ctx.setLineDash([]);

    // Rule of thirds
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 1;
    for (let i = 1; i <= 2; i++) {
      const lx = crop.x + (crop.w * i) / 3;
      const ly = crop.y + (crop.h * i) / 3;
      ctx.beginPath(); ctx.moveTo(lx, crop.y); ctx.lineTo(lx, crop.y + crop.h); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(crop.x, ly); ctx.lineTo(crop.x + crop.w, ly); ctx.stroke();
    }

    // Corner handles
    const handleSize = 8;
    ctx.fillStyle = '#fff';
    const corners = [
      [crop.x, crop.y],
      [crop.x + crop.w - handleSize, crop.y],
      [crop.x, crop.y + crop.h - handleSize],
      [crop.x + crop.w - handleSize, crop.y + crop.h - handleSize],
    ];
    corners.forEach(([cx, cy]) => {
      ctx.fillRect(cx, cy, handleSize, handleSize);
    });

    // Size label
    const realW = Math.round((crop.w / scale));
    const realH = Math.round((crop.h / scale));
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(crop.x, crop.y - 24, 120, 20);
    ctx.fillStyle = '#fff';
    ctx.font = '11px monospace';
    ctx.fillText(`${realW} × ${realH}`, crop.x + 6, crop.y - 8);
  }, [crop, loaded, zoom, canvasSize]);

  useEffect(() => { draw(); }, [draw]);

  const handleMouseDown = (e: React.MouseEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const hs = 12;

    if (mx >= crop.x - hs && mx <= crop.x + hs && my >= crop.y - hs && my <= crop.y + hs) {
      setDragType('nw');
    } else if (mx >= crop.x + crop.w - hs && mx <= crop.x + crop.w + hs && my >= crop.y - hs && my <= crop.y + hs) {
      setDragType('ne');
    } else if (mx >= crop.x - hs && mx <= crop.x + hs && my >= crop.y + crop.h - hs && my <= crop.y + crop.h + hs) {
      setDragType('sw');
    } else if (mx >= crop.x + crop.w - hs && mx <= crop.x + crop.w + hs && my >= crop.y + crop.h - hs && my <= crop.y + crop.h + hs) {
      setDragType('se');
    } else if (mx >= crop.x && mx <= crop.x + crop.w && my >= crop.y && my <= crop.y + crop.h) {
      setDragType('move');
    } else {
      return;
    }
    setDragging(true);
    setDragStart({ x: mx, y: my });
    setCropStart({ ...crop });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!dragging || !dragType) return;
    const rect = canvasRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const dx = mx - dragStart.x;
    const dy = my - dragStart.y;
    const ar = ASPECT_RATIOS.find((a) => a.value === aspect)?.ratio;
    const minSize = 40;

    let newCrop = { ...cropStart };

    if (dragType === 'move') {
      newCrop.x = Math.max(0, Math.min(canvasSize.w - cropStart.w, cropStart.x + dx));
      newCrop.y = Math.max(0, Math.min(canvasSize.h - cropStart.h, cropStart.y + dy));
    } else if (dragType === 'se') {
      newCrop.w = Math.max(minSize, Math.min(canvasSize.w - cropStart.x, cropStart.w + dx));
      newCrop.h = ar ? newCrop.w / ar : Math.max(minSize, Math.min(canvasSize.h - cropStart.y, cropStart.h + dy));
    } else if (dragType === 'nw') {
      const maxW = cropStart.x + cropStart.w;
      const maxH = cropStart.y + cropStart.h;
      newCrop.w = Math.max(minSize, Math.min(maxW, cropStart.w - dx));
      newCrop.h = ar ? newCrop.w / ar : Math.max(minSize, Math.min(maxH, cropStart.h - dy));
      newCrop.x = maxW - newCrop.w;
      newCrop.y = ar ? maxH - newCrop.h : Math.max(0, Math.min(maxH - minSize, cropStart.y + (cropStart.h - newCrop.h)));
    } else if (dragType === 'ne') {
      newCrop.w = Math.max(minSize, Math.min(canvasSize.w - cropStart.x, cropStart.w + dx));
      newCrop.h = ar ? newCrop.w / ar : Math.max(minSize, Math.min(canvasSize.h - cropStart.y, cropStart.h - dy));
      newCrop.y = ar ? (cropStart.y + cropStart.h) - newCrop.h : Math.max(0, cropStart.y);
    } else if (dragType === 'sw') {
      const maxW = cropStart.x + cropStart.w;
      newCrop.w = Math.max(minSize, Math.min(maxW, cropStart.w - dx));
      newCrop.h = ar ? newCrop.w / ar : Math.max(minSize, Math.min(canvasSize.h - cropStart.y, cropStart.h + dy));
      newCrop.x = maxW - newCrop.w;
    }

    setCrop(newCrop);
  };

  const handleMouseUp = () => {
    setDragging(false);
    setDragType(null);
  };

  const applyCrop = () => {
    const img = imgRef.current;
    const canvas = canvasRef.current;
    if (!img || !canvas) return;

    const scale = Math.min(canvasSize.w / img.naturalWidth, canvasSize.h / img.naturalHeight) * zoom;
    const imgX = (canvasSize.w - img.naturalWidth * scale) / 2;
    const imgY = (canvasSize.h - img.naturalHeight * scale) / 2;

    const sx = (crop.x - imgX) / scale;
    const sy = (crop.y - imgY) / scale;
    const sw = crop.w / scale;
    const sh = crop.h / scale;

    const out = document.createElement('canvas');
    out.width = Math.round(sw);
    out.height = Math.round(sh);
    const ctx = out.getContext('2d')!;
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, out.width, out.height);
    onApply(out.toDataURL('image/jpeg', 0.9));
  };

  return (
    <div className="modal-overlay wallpaper-editor-overlay" onClick={onClose}>
      <div className="modal wallpaper-editor-modal" onClick={(e) => e.stopPropagation()}>
        <div className="wallpaper-editor-header">
          <h2>Crop Wallpaper</h2>
          <button className="btn btn-sm" onClick={onClose}>✕</button>
        </div>

        <div className="wallpaper-editor-toolbar">
          <div className="wallpaper-editor-aspects">
            {ASPECT_RATIOS.map((a) => (
              <button
                key={a.value}
                className={`btn btn-sm ${aspect === a.value ? 'btn-primary' : ''}`}
                onClick={() => setAspect(a.value)}
              >
                {a.label}
              </button>
            ))}
          </div>
          <div className="wallpaper-editor-zoom">
            <button className="btn btn-sm" onClick={() => setZoom((z) => Math.max(0.5, z - 0.1))}>−</button>
            <span className="muted small">{Math.round(zoom * 100)}%</span>
            <button className="btn btn-sm" onClick={() => setZoom((z) => Math.min(3, z + 0.1))}>+</button>
          </div>
        </div>

        <div className="wallpaper-editor-canvas-wrap">
          <canvas
            ref={canvasRef}
            width={canvasSize.w}
            height={canvasSize.h}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            style={{ cursor: dragging ? 'grabbing' : 'crosshair' }}
          />
        </div>

        <div className="wallpaper-editor-actions">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={applyCrop}>Apply Crop</button>
        </div>
      </div>
    </div>
  );
}
