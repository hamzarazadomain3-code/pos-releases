// node:os shim — print/label plumbing reads tmpdir/platform. Deterministic stubs.
const anyFn: any = () => undefined;

const osStub: any = new Proxy(
  {},
  {
    get: (_target, prop: string) => {
      switch (prop) {
        case 'tmpdir':
        case 'homedir':
          return () => '/tmp';
        case 'cpus':
          return () => [{}, {}];
        case 'platform':
          return () => 'linux';
        case 'type':
          return () => 'Linux';
        case 'arch':
          return () => 'x64';
        case 'EOL':
          return '\n';
        case 'then':
          return undefined;
        default:
          return anyFn;
      }
    },
  }
);

export default osStub;

// The named imports the desktop code uses (the assistant's offline voice
// writes a temporary WAV — a Worker never does that, so it stays a stub).
export function tmpdir(): string {
  return '/tmp';
}
export function homedir(): string {
  return '/tmp';
}
export function platform(): string {
  return 'linux';
}
export function arch(): string {
  return 'x64';
}
export function cpus(): unknown[] {
  return [{}, {}];
}
