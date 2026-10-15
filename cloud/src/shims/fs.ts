// node:fs / fs shim — desktop file, backup and print plumbing imports these, but a
// Worker has no filesystem. Every call is a benign no-op so the bundle loads and
// only the few file-dependent channels fail, cleanly, if actually invoked.

const noop = (): undefined => undefined;

// A callable value that also answers any property access with itself, so
// `fs.existsSync(...)`, `fs.promises.writeFile(...)` and friends never throw at
// property-access time.
const anyFn: any = new Proxy(() => undefined, {
  get: () => anyFn,
  apply: () => undefined,
});

const fsStub: any = new Proxy(
  {},
  {
    get: (_target, prop: string) => (prop === 'then' ? undefined : anyFn),
  }
);

export default fsStub;

export function createWriteStream(): any {
  const stream: any = {
    write: () => true,
    end: noop,
    on: () => stream,
    once: () => stream,
    emit: () => false,
    close: noop,
    destroy: noop,
    pipe: noop,
  };
  return stream;
}
export function existsSync(): boolean {
  return false;
}
export function readFileSync(): string {
  return '';
}
export function writeFileSync(): void {}
export function mkdirSync(): void {}
export function readdirSync(): string[] {
  return [];
}
export function unlinkSync(): void {}
export function rmSync(): void {}
export function copyFileSync(): void {}
export function statSync(): any {
  return { size: 0, mtimeMs: 0, isDirectory: () => false, isFile: () => true };
}
export const promises = {
  writeFile: async (): Promise<void> => {},
  readFile: async (): Promise<string> => '',
  mkdir: async (): Promise<void> => {},
  stat: async (): Promise<unknown> => ({}),
  unlink: async (): Promise<void> => {},
  readdir: async (): Promise<string[]> => [],
};
