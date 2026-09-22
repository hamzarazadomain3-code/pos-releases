import { useEffect, useRef } from 'react';

interface UseBarcodeScanOptions {
  onScan: (code: string) => void;
  minLength?: number;
  scanTimeout?: number;
  enabled?: boolean;
}

export function useBarcodeScan({
  onScan,
  minLength = 8,
  scanTimeout = 50,
  enabled = true,
}: UseBarcodeScanOptions) {
  const bufferRef = useRef('');
  const lastKeyRef = useRef(0);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  useEffect(() => {
    if (!enabled) return;

    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && target.tagName === 'TEXTAREA') return;

      const now = Date.now();
      if (e.key === 'Enter' || e.key === '\r' || e.key === '\n') {
        const buf = bufferRef.current;
        bufferRef.current = '';
        lastKeyRef.current = now;
        if (buf.length >= minLength) {
          e.preventDefault();
          e.stopPropagation();
          onScanRef.current(buf);
        }
        return;
      }

      if (e.key.length === 1) {
        if (now - lastKeyRef.current > scanTimeout) bufferRef.current = '';
        bufferRef.current += e.key;
        lastKeyRef.current = now;
      }
    };

    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [enabled, minLength, scanTimeout]);

  return {
    clear: () => {
      bufferRef.current = '';
    },
  };
}