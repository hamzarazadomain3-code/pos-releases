// pdfkit shim — `reports.ts` lazily `require('pdfkit')` to build the report PDF.
//
// A Worker CANNOT build a PDF with pdfkit: the library loads its standard-font
// metrics (.afm files) from disk, and a Worker has no filesystem. Bundling
// pdfkit would therefore produce a broken document, and the old inert document
// produced an EMPTY file that downloaded as a corrupt PDF.
//
// So the web build fails cleanly instead: the owner gets a plain-English
// message ("Report PDF export needs the Windows app") rather than a broken
// file. The desktop build uses the real pdfkit and is unaffected.
export const WEB_PDF_MESSAGE =
  'Report PDF export needs the Windows app — the browser version cannot build a PDF file. Use "Excel (Full)" instead.';

export class PDFDocument {
  constructor(_options?: unknown) {
    throw new Error(WEB_PDF_MESSAGE);
  }
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
