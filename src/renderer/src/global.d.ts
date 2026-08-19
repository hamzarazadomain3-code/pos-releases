import type { PosBridge } from '../../shared/types';

declare global {
  interface Window {
    api: PosBridge;
  }
}

export {};