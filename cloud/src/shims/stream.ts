// stream shim — the SheetJS library asks for Node's `stream` at load time
// (`var strmod = require('stream')` inside `make_xlsx_lib`) and only stores
// `strmod.Readable` for its optional `XLSX.stream.*` helpers, which the POS
// never uses (it reads and writes workbooks as bytes).
//
// A Worker has no Node streams, and esbuild cannot resolve the bare `stream`
// specifier for a neutral-platform bundle, so this tiny stand-in keeps the
// library loadable. The helpers it enables stay unused.
export class Readable {
  push(): boolean {
    return false;
  }
  on(): this {
    return this;
  }
  once(): this {
    return this;
  }
  emit(): boolean {
    return false;
  }
}

export class Writable {
  write(): boolean {
    return true;
  }
  on(): this {
    return this;
  }
  once(): this {
    return this;
  }
  end(): this {
    return this;
  }
}

export class PassThrough extends Readable {}

export default { Readable, Writable, PassThrough };
