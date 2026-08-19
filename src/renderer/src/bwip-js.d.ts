declare module 'bwip-js' {
  export interface BwipOptions {
    bcid: string;
    text: string;
    scale?: number;
    height?: number;
    includetext?: boolean;
    textxalign?: string;
    paddingwidth?: number;
    paddingheight?: number;
    backgroundcolor?: string;
    barcolor?: string;
  }
  interface BwipJs {
    toCanvas(canvas: HTMLCanvasElement, options: BwipOptions): HTMLCanvasElement;
    toBuffer(options: BwipOptions, callback: (err: string | Error | null, buffer?: Buffer) => void): void;
    (options: BwipOptions): string | Buffer;
  }
  const bwipjs: BwipJs;
  export default bwipjs;
}