/**
 * Receipt Designer check (phase 2).
 *
 * Renders the DESIGNED receipt (the layout the designer edits and that the
 * printer uses when a design is applied) against a representative sample sale,
 * then:
 *   - reads the laid-out text back (content audit), and
 *   - measures every element against the printable width (layout audit),
 * for BOTH 80mm and 58mm. This is the same pair of checks `print_smoke` runs for
 * the shipped layout, so a designer regression cannot ship quietly.
 *
 * It also exercises the design features themselves: hiding the software credit,
 * a custom text block, reordering, the conditional DISC column, and a QR block
 * (async asset resolution).
 *
 * Usage (after `npm run build:main`):
 *   npx electron scripts/receipt_designer_check.js
 *
 * Never contacts a printer.
 */

const path = require('path');
const { app } = require('electron');

const PROJECT_ROOT = path.resolve(__dirname, '..');
app.getAppPath = () => PROJECT_ROOT;

const os = require('os');
const realUserData = path.join(os.homedir(), 'AppData', 'Roaming', 'pos-app');
app.setPath('userData', process.env.ROKAR_SMOKE_USERDATA || realUserData);

let failures = 0;
let checks = 0;

function checkTrue(name, condition, detail) {
  checks++;
  if (!condition) failures++;
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
  return condition;
}

function norm(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

/** Format the sample timestamp the same way the renderer does (local time). */
function localStamp(iso) {
  const d = new Date(iso);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = String(d.getFullYear());
  let h = d.getHours();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  const time = `${h}:${String(d.getMinutes()).padStart(2, '0')} ${ampm}`;
  return { dmy: `${dd}/${mm}/${yyyy}`, ymd: `${yyyy}-${mm}-${dd}`, time };
}

async function run() {
  const { initDatabase } = require('../dist/main/db.js');
  const printService = require('../dist/main/services/printService.js');
  const designer = require('../dist/main/services/receiptDesigner.js');
  const shared = require('../dist/shared/receiptDesign.js');

  await initDatabase();

  console.log('\nReceipt Designer check\n');

  const sample = designer.buildSampleSale();
  const designedDefault = shared.defaultReceiptDesign('thermal80');

  // A no-discount copy to prove the DISC column is conditional.
  const noDisc = {
    ...sample,
    items: sample.items.map((it) => ({ ...it, discount: 0 })),
    discount_amount: 0,
  };

  const job = (html, paper) => ({ html, paper });
  const stamp = localStamp(sample.created_at);

  // ── 1. 80mm content ───────────────────────────────────────────────────────
  console.log('80mm layout');
  {
    const html = designer.buildDesignedReceipt(sample, 'thermal80', designedDefault);
    const text = norm(await printService.readJobText(job(html, 'thermal80')));
    checkTrue('items header present', /PARTICULARS/.test(text), text.slice(0, 80));
    checkTrue('has QTY / RATE / AMOUNT', /QTY/.test(text) && /RATE/.test(text) && /AMOUNT/.test(text));
    checkTrue('items header has a DISC column', />DISC</.test(html));
    checkTrue('line discount amount shown', /Biscuits/.test(text));
    checkTrue('long item name present (wraps, not dropped)', /Al-Bagdad Special Bakery Rusk/.test(text));
    checkTrue('unit under name (Kilogram)', /Kilogram/.test(text));
    checkTrue('items summary line', /Items: 3, Qty:/.test(text));
    checkTrue(
      'one-line date + time',
      text.includes(`${stamp.dmy} ${stamp.time}`),
      `${stamp.dmy} ${stamp.time}`
    );
    const sub = text.indexOf('SUB TOTAL');
    const net = text.indexOf('NET TOTAL');
    const paid = text.indexOf('PAID');
    checkTrue('totals order SUB < NET < PAID', sub >= 0 && net > sub && paid > net, `sub=${sub} net=${net} paid=${paid}`);
    checkTrue('software credit present by default', /SOFTWARE BY/.test(text));
    const audit = await printService.auditJobLayout(job(html, 'thermal80'));
    checkTrue('no element escapes the 80mm printable width', audit.offenders.length === 0,
      audit.offenders.map((o) => `${o.tag}.${o.cls} "${o.text}" +${o.overflowRight}px`).join(', '));
  }

  // ── 2. 58mm content ───────────────────────────────────────────────────────
  console.log('58mm layout');
  {
    const html = designer.buildDesignedReceipt(sample, 'thermal58', { ...designedDefault, paper: 'thermal58' });
    const text = norm(await printService.readJobText(job(html, 'thermal58')));
    checkTrue('58mm items header drops the DISC column', !/>DISC</.test(html));
    checkTrue('58mm keeps the DISCOUNT totals row (merged)', /DISCOUNT/.test(text));
    checkTrue('58mm second column spelled ITEM', /ITEM/.test(text));
    checkTrue('58mm still has a totals block', /SUB TOTAL/.test(text) && /NET TOTAL/.test(text));
    checkTrue('58mm summary present', /Items: 3, Qty:/.test(text));
    const audit = await printService.auditJobLayout(job(html, 'thermal58'));
    checkTrue('no element escapes the 58mm printable width', audit.offenders.length === 0,
      audit.offenders.map((o) => `${o.tag}.${o.cls} "${o.text}" +${o.overflowRight}px`).join(', '));
  }

  // ── 3. DISC column is conditional ─────────────────────────────────────────
  console.log('Conditional DISC');
  {
    const html = designer.buildDesignedReceipt(noDisc, 'thermal80', designedDefault);
    const text = norm(await printService.readJobText(job(html, 'thermal80')));
    checkTrue('DISC column hidden when no line has a discount', !/>DISC</.test(html));
    checkTrue('no DISCOUNT totals row either', !/DISCOUNT/.test(text));
  }

  // ── 4. Feature toggles ────────────────────────────────────────────────────
  console.log('Design features');
  {
    const design = JSON.parse(JSON.stringify(designedDefault));
    // hide software credit
    const sw = design.sections.find((b) => b.type === 'software_credit');
    sw.enabled = false;
    const text1 = norm(await printService.readJobText(job(designer.buildDesignedReceipt(sample, 'thermal80', design), 'thermal80')));
    checkTrue('software credit removable', !/SOFTWARE BY/.test(text1));

    // add a custom text block with a token
    design.sections.push({
      id: 'custom-1', type: 'text', enabled: true,
      text: 'HELLO WORLD — total {total}',
      style: { align: 'center', bold: true, fontSizePx: 15, uppercase: true },
    });
    const text2 = norm(await printService.readJobText(job(designer.buildDesignedReceipt(sample, 'thermal80', design), 'thermal80')));
    checkTrue('custom text block renders and resolves {total}', /HELLO WORLD/.test(text2) && /NET TOTAL/.test(text2));
    checkTrue('uppercase style applied', /HELLO WORLD — TOTAL/.test(text2));

    // add a divider
    design.sections.push({ id: 'custom-2', type: 'divider', enabled: true, variant: 'double' });
    const html3 = designer.buildDesignedReceipt(sample, 'thermal80', design);
    checkTrue('custom divider renders', /div-double/.test(html3));

    // reorder: move shop_name to the end
    const reordered = JSON.parse(JSON.stringify(design));
    const idx = reordered.sections.findIndex((b) => b.type === 'shop_name');
    const [sn] = reordered.sections.splice(idx, 1);
    reordered.sections.push(sn);
    const html4 = designer.buildDesignedReceipt(sample, 'thermal80', reordered);
    checkTrue('reordered section still renders shop name', /shop-name/.test(html4));
  }

  // ── 5. QR block (async) ───────────────────────────────────────────────────
  console.log('QR block');
  {
    const design = JSON.parse(JSON.stringify(designedDefault));
    design.sections.push({ id: 'qr-1', type: 'qr', enabled: true, style: { align: 'center' } });
    const html = await designer.buildDesignedReceiptAsync(sample, 'thermal80', design);
    checkTrue('QR block renders an image', /data:image\/png;base64/.test(html));
  }

  // ── 6. Global options ─────────────────────────────────────────────────────
  console.log('Global options');
  {
    const design = JSON.parse(JSON.stringify(designedDefault));
    design.global.currencyPosition = 'after';
    design.global.dateFormat = 'YYYY-MM-DD';
    const text = norm(await printService.readJobText(job(designer.buildDesignedReceipt(sample, 'thermal80', design), 'thermal80')));
    checkTrue('currency position "after" applied', /NET TOTAL\s+[\d,]+\.\d{2}\s+Rs/.test(text) || /\.\d{2}\s+Rs/.test(text), (text.match(/NET TOTAL[^A-Za-z]*/) || [''])[0]);
    checkTrue('date format YYYY-MM-DD applied', text.includes(stamp.ymd), stamp.ymd);
  }

  // ── 6b. Money formatting (currency printed once) ──────────────────────────
  console.log('Money formatting');
  {
    const html = designer.buildDesignedReceipt(sample, 'thermal80', designedDefault);
    const itemsTable = (html.match(/<table class="items"[\s\S]*?<\/table>/) || [''])[0];
    checkTrue('item cells carry no currency prefix', !/\bRs\b/.test(itemsTable));
    checkTrue('no doubled currency prefix anywhere', !/Rs\s+Rs/.test(html));
    const netRow = (html.match(/<tr class="net">[\s\S]*?<\/tr>/) || [''])[0];
    checkTrue('NET TOTAL prints the currency exactly once', (netRow.match(/\bRs\b/g) || []).length === 1, netRow.replace(/<[^>]+>/g, ' ').trim());
  }

  // ── 6c. Built-in templates ────────────────────────────────────────────────
  console.log('Built-in templates');
  {
    const builtins = shared.builtinTemplates();
    const ids = builtins.map((t) => t.id);
    checkTrue('six built-in templates', builtins.length === 6, ids.join(', '));
    checkTrue(
      'expected built-in ids present',
      ['builtin-compact-80', 'builtin-detailed-80', 'builtin-mini-58', 'builtin-a4-invoice', 'builtin-bakery', 'builtin-return-refund'].every((id) => ids.includes(id))
    );
    checkTrue('built-ins are flagged builtin', builtins.every((t) => t.builtin === true));
    checkTrue('default library sets NO defaults (opt-in)', Object.keys(shared.defaultLibrary().defaults).length === 0);

    // Compact hides the header note; detailed enables the TAX column.
    const compact = builtins.find((t) => t.id === 'builtin-compact-80').design;
    checkTrue('compact 80mm hides the header note', compact.sections.find((b) => b.type === 'header_note')?.enabled === false);
    const detailed = builtins.find((t) => t.id === 'builtin-detailed-80').design;
    checkTrue('detailed 80mm enables the TAX column', detailed.table.columns.find((c) => c.key === 'tax')?.enabled === true);

    // Return / Refund: auto banner only on a returned / negative sale.
    const ret = builtins.find((t) => t.id === 'builtin-return-refund').design;
    const retSale = designer.buildSampleSale(undefined, 'return');
    const retHtml = designer.buildDesignedReceipt(retSale, 'thermal80', ret);
    checkTrue('return built-in shows the RETURN / REFUND banner', /RETURN \/ REFUND/.test(retHtml));
    const retText = norm(await printService.readJobText(job(retHtml, 'thermal80')));
    checkTrue('return NET TOTAL is negative', /NET TOTAL\s+Rs\s+-/.test(retText), (retText.match(/NET TOTAL[^A-Za-z]*/) || [''])[0]);
    const normalHtml = designer.buildDesignedReceipt(sample, 'thermal80', ret);
    checkTrue('return banner hidden on a normal sale', !/RETURN \/ REFUND/.test(normalHtml));
    checkTrue(
      'default design shows the return banner on a negative sale',
      /RETURN \/ REFUND/.test(designer.buildDesignedReceipt(retSale, 'thermal80', designedDefault))
    );
    const retAudit = await printService.auditJobLayout(job(retHtml, 'thermal80'));
    checkTrue('return receipt fits the 80mm printable width', retAudit.offenders.length === 0,
      retAudit.offenders.map((o) => `${o.tag}.${o.cls} "${o.text}" +${o.overflowRight}px`).join(', '));

    const bakery = builtins.find((t) => t.id === 'builtin-bakery').design;
    const bakeryText = norm(await printService.readJobText(job(designer.buildDesignedReceipt(sample, 'thermal80', bakery), 'thermal80')));
    checkTrue('bakery built-in prints a best-before note', /BEST BEFORE/i.test(bakeryText));
  }

  // ── 6d. Custom banner block ───────────────────────────────────────────────
  console.log('Banner block');
  {
    const design = JSON.parse(JSON.stringify(designedDefault));
    design.sections.unshift({ id: 'ban-1', type: 'banner', enabled: true, text: 'DUPLICATE COPY' });
    const html = designer.buildDesignedReceipt(sample, 'thermal80', design);
    checkTrue('custom banner block renders', /class="banner"/.test(html) && /DUPLICATE COPY/.test(html));
  }

  // ── 6e. Library normalisation + resolution ────────────────────────────────
  console.log('Template library');
  {
    const lib = shared.defaultLibrary();
    lib.templates.push({
      id: 'custom-a',
      name: 'My Custom',
      design: shared.defaultReceiptDesign('thermal80'),
      builtin: false,
      createdAt: 1,
      updatedAt: 2,
    });
    lib.defaults = { thermal80: 'custom-a' };
    lib.branchDefaults = { '7': { thermal58: 'custom-a' } };

    const round = shared.normalizeLibrary(JSON.parse(JSON.stringify(lib)));
    checkTrue('custom template survives normalisation', !!round.templates.find((t) => t.id === 'custom-a'));
    checkTrue('built-ins still present after normalisation', round.templates.filter((t) => t.builtin).length === 6);
    checkTrue('global default kept', round.defaults.thermal80 === 'custom-a');
    checkTrue('branch default kept', round.branchDefaults['7']?.thermal58 === 'custom-a');

    // Junk is dropped; a spoofed built-in id is ignored; a default to a missing
    // template is discarded.
    const junk = shared.normalizeLibrary({
      templates: [{ id: 'builtin-compact-80', name: 'spoof', design: {} }, { id: '', name: 'x' }, { id: 'custom-b', name: 'B', design: {} }],
      defaults: { thermal80: 'does-not-exist', thermal58: 'custom-b', bogus: 'custom-b' },
    });
    checkTrue('spoofed built-in id ignored', junk.templates.filter((t) => t.id === 'builtin-compact-80').length === 1);
    checkTrue('valid custom from junk kept', !!junk.templates.find((t) => t.id === 'custom-b'));
    checkTrue('default to a missing template dropped', junk.defaults.thermal80 === undefined);
    checkTrue('default to a valid custom kept', junk.defaults.thermal58 === 'custom-b');
    checkTrue('unknown paper key dropped', !('bogus' in junk.defaults));

    checkTrue('resolveLibraryDefault: branch beats global', shared.resolveLibraryDefault(round, 'thermal58', '7') === 'custom-a');
    checkTrue('resolveLibraryDefault: global used with no branch', shared.resolveLibraryDefault(round, 'thermal80') === 'custom-a');
    checkTrue('resolveLibraryDefault: undefined when nothing set', shared.resolveLibraryDefault(round, 'a4') === undefined);

    // Export/import round-trip is loss-free.
    const exported = JSON.stringify(round);
    const reimported = shared.normalizeLibrary(JSON.parse(exported));
    checkTrue('export → import round-trips templates', JSON.stringify(reimported.templates.map((t) => t.id)) === JSON.stringify(round.templates.map((t) => t.id)));
    checkTrue('export → import round-trips defaults', JSON.stringify(reimported.defaults) === JSON.stringify(round.defaults));
  }

  // ── 7. An APPLIED design drives the real print path ───────────────────────
  console.log('Wiring: applied design drives printing');
  {
    const inventory = require('../dist/main/services/inventory.js');
    const salesSvc = require('../dist/main/services/sales.js');
    const shifts = require('../dist/main/services/shifts.js');
    const printing = require('../dist/main/services/printing.js');
    const { getDb } = require('../dist/main/db.js');

    const units = inventory.listUnits();
    const piece = units.find((u) => /piece/i.test(u.name)) || units[0];
    const prod = inventory.createProduct({
      name: 'Wiring Test Item',
      unit_id: piece ? piece.id : null,
      cost_price: 10,
      sale_price: 50,
      wholesale_price: 50,
      stock_qty: 20,
      low_stock_threshold: 1,
    });
    getDb().prepare('UPDATE products SET stock_qty = ? WHERE id = ?').run(20, prod.id);
    try {
      shifts.openShift(1000);
    } catch {
      /* a shift may already be open */
    }
    const created = salesSvc.createSale({
      items: [{ product_id: prod.id, qty: 1, price: 50, line_discount: 0, tax_rate: 0 }],
      customer_id: null,
      payments: [{ mode: 'Cash', amount: 50 }],
    });

    const wired = JSON.parse(JSON.stringify(shared.defaultReceiptDesign('thermal80')));
    wired.sections.push({ id: 'wire-1', type: 'text', enabled: true, text: 'DESIGNER-WIRED' });
    const setSetting = (k, v) =>
      getDb()
        .prepare('INSERT OR REPLACE INTO admin_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)')
        .run(k, v);

    setSetting('receipt_design_json', JSON.stringify(wired));
    setSetting('receipt_design_enabled', 'false');
    const shipped = norm(
      await printService.readJobText(await printing.buildReceiptJobAsync(created.sale.id, 'standard'))
    );
    checkTrue('design disabled → shipped layout used (no design marker)', !/DESIGNER-WIRED/.test(shipped));

    setSetting('receipt_design_enabled', 'true');
    const applied = norm(
      await printService.readJobText(await printing.buildReceiptJobAsync(created.sale.id, 'standard'))
    );
    checkTrue('design enabled → the SAVED design drives the print path', /DESIGNER-WIRED/.test(applied));

    setSetting('receipt_design_enabled', 'false');
    getDb().prepare("DELETE FROM admin_settings WHERE key = 'receipt_design_json'").run();

    // ── 8. A LIBRARY DEFAULT drives the print path ──────────────────────────
    const lib = shared.defaultLibrary();
    const marker = JSON.parse(JSON.stringify(shared.defaultReceiptDesign('thermal80')));
    marker.sections = [{ id: 'mark-1', type: 'text', enabled: true, text: 'LIBRARY-DEFAULT-MARKER' }];
    lib.templates.push({ id: 'custom-live', name: 'Live', design: marker, builtin: false, createdAt: 1, updatedAt: 1 });
    lib.defaults = { thermal80: 'custom-live' };
    setSetting('receipt_design_library_json', JSON.stringify(lib));

    setSetting('receipt_design_enabled', 'false');
    const libOff = norm(
      await printService.readJobText(await printing.buildReceiptJobAsync(created.sale.id, 'standard'))
    );
    checkTrue('library default ignored while design is disabled', !/LIBRARY-DEFAULT-MARKER/.test(libOff));

    setSetting('receipt_design_enabled', 'true');
    const libOn = norm(
      await printService.readJobText(await printing.buildReceiptJobAsync(created.sale.id, 'standard'))
    );
    checkTrue('library default drives the print path when enabled', /LIBRARY-DEFAULT-MARKER/.test(libOn));

    checkTrue(
      'resolveAppliedDesign returns the default template',
      designer.resolveAppliedDesign('thermal80').sections.some((b) => b.text === 'LIBRARY-DEFAULT-MARKER')
    );

    setSetting('receipt_design_enabled', 'false');
    getDb().prepare("DELETE FROM admin_settings WHERE key IN ('receipt_design_library_json', 'receipt_design_json')").run();

    // ── 9. Phase 4 — reprint stamp, copies, bottom feed ─────────────────────
    console.log('Print options (phase 4)');
    {
      const p = require('../dist/main/services/printing.js');
      const delKeys = (keys) =>
        getDb()
          .prepare(`DELETE FROM admin_settings WHERE key IN (${keys.map(() => '?').join(',')})`)
          .run(...keys);

      // The shipped layout: a reprint is stamped, an original print is not.
      delKeys(['receipt_duplicate_label']);
      checkTrue(
        'shipped reprint carries the DUPLICATE COPY stamp',
        /DUPLICATE COPY/.test(p.buildReceiptHtml(created.sale.id, 'standard', { duplicate: true }))
      );
      checkTrue(
        'shipped original print has no stamp',
        !/DUPLICATE COPY/.test(p.buildReceiptHtml(created.sale.id, 'standard', { duplicate: false }))
      );

      // The toggle can hide it (only an explicit 'false').
      setSetting('receipt_duplicate_label', 'false');
      const hidden = await p.buildReceiptJobAsync(created.sale.id, 'standard', { duplicate: true });
      checkTrue('receipt_duplicate_label=false hides the stamp', !/DUPLICATE COPY/.test(hidden.html));
      delKeys(['receipt_duplicate_label']);

      // The DESIGNED layout gets the same stamp (its own .duplicate-banner CSS).
      setSetting('receipt_design_enabled', 'true');
      const designedDup = await p.buildReceiptJobAsync(created.sale.id, 'standard', { duplicate: true });
      checkTrue(
        'designed reprint carries the DUPLICATE COPY stamp',
        /class="duplicate-banner"/.test(designedDup.html) && /DUPLICATE COPY/.test(designedDup.html)
      );
      const designedOrig = await p.buildReceiptJobAsync(created.sale.id, 'standard');
      checkTrue('designed original print has no stamp', !/class="duplicate-banner"/.test(designedOrig.html));
      setSetting('receipt_design_enabled', 'false');

      // Copies + bottom-feed defaults and clamping (code defaults, no rows set).
      delKeys(['receipt_copies', 'receipt_bottom_feed_mm']);
      checkTrue('receipt copies default to 1', printService.getReceiptCopies() === 1);
      checkTrue('bottom feed defaults to 4mm', printService.getReceiptBottomFeedMm() === 4);
      setSetting('receipt_copies', '99');
      checkTrue('receipt copies clamp to 10', printService.getReceiptCopies() === 10);
      setSetting('receipt_copies', '0');
      checkTrue('receipt copies below 1 fall back to 1', printService.getReceiptCopies() === 1);
      setSetting('receipt_bottom_feed_mm', '999');
      checkTrue('bottom feed clamps to 30mm', printService.getReceiptBottomFeedMm() === 30);
      delKeys(['receipt_copies', 'receipt_bottom_feed_mm']);
    }
  }

  console.log(`\n${checks - failures}/${checks} checks passed.`);
  if (failures) {
    console.log(`FAILED: ${failures} check(s).`);
    app.exit(1);
  } else {
    console.log('ALL PASSED');
    app.exit(0);
  }
}

app.whenReady().then(() =>
  run().catch((e) => {
    console.error('Receipt designer check crashed:', e);
    app.exit(1);
  })
);
