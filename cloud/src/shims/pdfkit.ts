// pdfkit shim — `reports.ts` lazily `require('pdfkit')` to build report PDFs,
// which a Worker cannot stream to disk. An inert document class keeps the
// module graph whole; the export channel fails cleanly if invoked.
export class PDFDocument {
  constructor(_options?: unknown) {}
  on(): this {
    return this;
  }
  end(): void {}
  text(): this {
    return this;
  }
  addPage(): this {
    return this;
  }
  pipe(): this {
    return this;
  }
  rect(): this {
    return this;
  }
  fill(): this {
    return this;
  }
}
export default PDFDocument;
