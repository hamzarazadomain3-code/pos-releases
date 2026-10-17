import { esc, getPrintSettings, htmlDocument, makeMoney } from './printDocs';
import { previewDocument, printDocument, printJobToPdf, type PrintJob, type PrintResult } from './printService';
import { getUdhaarEntry, getUdhaarLedger, getUdhaarStatement, type UdhaarStatementRange } from './udhaar';
import { formatLocalString } from '../utils/timezone';
import type { Customer, UdhaarEntryDetail, UdhaarItemLine, UdhaarLedgerRow } from '../../shared/types';

/**
 * Customer statement of account — the "Print Statement" button's document.
 *
 * Two papers, one data source: A4 for the office/file and 80mm for a shop that
 * only owns a receipt printer. Both render the SAME statement rows, so the two
 * can never disagree. The statement honours a date range (opening balance →
 * entries → closing balance) and can include the item detail behind each charge.
 */

export type StatementPaper = 'a4' | 'thermal80' | 'thermal58';

function resolvePaper(paper?: StatementPaper): StatementPaper {
  if (paper === 'thermal80' || paper === 'thermal58' || paper === 'a4') return paper;
  return 'a4';
}

function modeLabel(type: string): string {
  const parts = type.split(':');
  if (parts[0] === 'payment') return `Payment (${parts[1] || 'Cash'})`;
  if (parts[0] === 'write_off') return 'Write-off';
  if (parts[0] === 'opening_balance' || type === 'opening_balance') return 'Opening balance';
  if (type === 'sale') return 'Credit sale';
  if (type === 'udhaar_items') return 'Udhaar items';
  return type;
}

/** Human particulars for one ledger row. */
function particulars(row: UdhaarLedgerRow): string {
  if (row.direction === 'credit') {
    const note = row.note ? ` — ${row.note}` : '';
    return `${modeLabel(row.type)}${note}`;
  }
  if (row.sale_id && row.invoice_no) return `Credit sale (${row.invoice_no})`;
  if (row.type === 'opening_balance') return 'Opening balance';
  return row.note || modeLabel(row.type);
}

function fmtDate(ts: string | null | undefined): string {
  if (!ts) return '—';
  try {
    return formatLocalString(ts);
  } catch {
    return String(ts);
  }
}

function unitQty(it: UdhaarItemLine): string {
  const unit = it.unit ? ` ${it.unit}` : '';
  return `${it.qty}${unit}`;
}

export interface StatementContext {
  customer: Customer;
  statement: UdhaarStatementRange;
  shop: Record<string, string>;
  money: (n: number) => string;
}

export function buildStatementContext(
  customerId: number,
  from?: string,
  to?: string
): StatementContext {
  const { ledger, statement } = getUdhaarStatement(customerId, from, to);
  const shop = getPrintSettings();
  const currency = shop.currency || 'Rs';
  return { customer: ledger.customer, statement, shop, money: makeMoney(currency) };
}

function summaryStrip(ctx: StatementContext): string {
  const { statement, money } = ctx;
  const charged = statement.rows.filter((r) => r.amount > 0).reduce((s, r) => s + r.amount, 0);
  const paid = statement.rows.filter((r) => r.amount < 0).reduce((s, r) => s + Math.abs(r.amount), 0);
  return `<div class="strip">
  <div class="cell"><span>Opening balance</span><b>${money(statement.opening_balance)}</b></div>
  <div class="cell"><span>Charged (udhaar)</span><b>${money(charged)}</b></div>
  <div class="cell"><span>Received</span><b>${money(paid)}</b></div>
  <div class="cell strong"><span>Closing balance</span><b>${money(statement.closing_balance)}</b></div>
</div>`;
}

/**
 * A short, plain-text WhatsApp payment reminder for one customer — the message
 * the Udhaar list's "Remind" action sends. Deliberately NOT a statement: it
 * states the balance, the overdue amount if any, and closes with a courteous
 * ask plus the shop's phone number.
 */
export function reminderText(customerId: number): string {
  const { customer, summary } = getUdhaarLedger(customerId);
  const shop = getPrintSettings();
  const money = makeMoney(shop.currency || 'Rs');

  const lines = [`*${shop.shop_name || 'Shop'}* — Payment reminder`, ''];
  lines.push(`Dear ${customer.name},`);
  lines.push(`Your outstanding udhaar balance is *${money(summary.outstanding)}*.`);
  if (summary.overdue_amount > 0) {
    lines.push(`Of this, *${money(summary.overdue_amount)}* is overdue.`);
  }
  lines.push('');
  lines.push('Kindly clear your balance at your earliest convenience. Thank you!');
  if (shop.shop_phone) {
    lines.push('');
    lines.push(`For queries: ${shop.shop_phone}`);
  }
  return lines.join('\n');
}

function periodLabel(ctx: StatementContext): string {
  const { from, to } = ctx.statement;
  if (from && to) return `${from} — ${to}`;
  if (from) return `From ${from}`;
  if (to) return `Up to ${to}`;
  return 'All transactions';
}

// ═══════════════════════════════════════════════════════════════════
//  A4 STATEMENT
// ═══════════════════════════════════════════════════════════════════

const A4_W = 210;
const A4_H = 297;
const A4_PAD = 12;

function a4Css(withItems: boolean): string {
  return `
@page { size: ${A4_W}mm ${A4_H}mm; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #fff; }
body {
  width: ${A4_W}mm; min-height: ${A4_H}mm; padding: ${A4_PAD}mm;
  font-family: 'Segoe UI', Arial, sans-serif; font-size: 9.5pt; color: #0f172a;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
.doc-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12mm; border-bottom: 2.5pt solid #4f46e5; padding-bottom: 6mm; }
.doc-head .co h1 { margin: 0; font-size: 17pt; color: #4f46e5; letter-spacing: -0.2pt; }
.doc-head .co p { margin: 1.2mm 0 0; font-size: 9pt; color: #64748b; line-height: 1.4; }
.doc-head .meta { text-align: right; white-space: nowrap; }
.doc-head .meta .title { font-size: 19pt; font-weight: 700; color: #4f46e5; letter-spacing: 1.5pt; margin: 0; }
.doc-head .meta .line { font-size: 9pt; color: #64748b; margin-top: 1mm; }
.party { margin: 6mm 0 0; border: 0.6pt solid #e2e8f0; border-radius: 1.5mm; padding: 3.5mm 4mm; }
.party h3 { margin: 0 0 2mm; font-size: 8pt; text-transform: uppercase; letter-spacing: 0.8pt; color: #4f46e5; }
.party .big { font-size: 12pt; font-weight: 700; }
.party .sub { font-size: 9pt; color: #475569; margin-top: 0.8mm; }
.strip { display: flex; gap: 4mm; margin: 5mm 0; }
.strip .cell { flex: 1; border: 0.6pt solid #e2e8f0; border-radius: 1.5mm; padding: 2.6mm 3mm; }
.strip .cell span { display: block; font-size: 7.5pt; text-transform: uppercase; letter-spacing: 0.5pt; color: #64748b; }
.strip .cell b { display: block; font-size: 12pt; margin-top: 0.8mm; font-variant-numeric: tabular-nums; }
.strip .cell.strong { border-color: #4f46e5; }
.strip .cell.strong b { color: #4f46e5; }
h2.sec { font-size: 10pt; text-transform: uppercase; letter-spacing: 0.8pt; color: #475569; margin: 6mm 0 2mm; }
table.ledger, table.items-detail { width: 100%; border-collapse: collapse; }
table.ledger thead, table.items-detail thead { display: table-header-group; }
table.ledger tr, table.items-detail tr { page-break-inside: avoid; break-inside: avoid; }
table.ledger thead th, table.items-detail thead th {
  text-align: left; font-size: 8pt; text-transform: uppercase; letter-spacing: 0.4pt;
  color: #475569; background: #f1f5f9; border-bottom: 1pt solid #cbd5e1; padding: 2.2mm 2mm; white-space: nowrap;
}
table.ledger td, table.items-detail td { padding: 2mm 2mm; border-bottom: 0.5pt solid #e2e8f0; vertical-align: top; }
td.r, th.r { text-align: right; font-variant-numeric: tabular-nums; }
td.name { font-weight: 600; }
tr.overdue td { background: #fef2f2; }
.tag { display: inline-block; font-size: 7pt; padding: 0.4mm 1.4mm; border-radius: 1mm; margin-left: 1.5mm; vertical-align: middle; }
.tag.due { background: #fee2e2; color: #b91c1c; }
.tag.paid { background: #dcfce7; color: #15803d; }
.terms { margin-top: 6mm; font-size: 8pt; color: #64748b; line-height: 1.5; }
.doc-foot { margin-top: 6mm; border-top: 0.5pt solid #e2e8f0; padding-top: 3mm; text-align: center; font-size: 8pt; color: #64748b; }
${withItems ? '' : ''}`;
}

function a4Body(ctx: StatementContext): string {
  const { customer, statement, shop, money } = ctx;
  const showItems = statement.items.length > 0;

  const ledgerRows = statement.rows
    .map((r) => {
      const debit = r.amount > 0 ? money(r.amount) : '';
      const credit = r.amount < 0 ? money(Math.abs(r.amount)) : '';
      const tag = r.overdue
        ? '<span class="tag due">Overdue</span>'
        : r.direction === 'credit'
          ? ''
          : r.paid
            ? '<span class="tag paid">Paid</span>'
            : '';
      return `<tr class="${r.overdue ? 'overdue' : ''}">
  <td>${esc(fmtDate(r.created_at))}</td>
  <td class="name">${esc(particulars(r))}${tag}</td>
  <td class="r">${debit}</td>
  <td class="r">${credit}</td>
  <td class="r">${money(r.running)}</td>
</tr>`;
    })
    .join('');

  const itemRows = statement.items
    .map(
      (it) => `<tr>
  <td>${esc(fmtDate(it.created_at))}</td>
  <td>${esc(it.invoice_no || '—')}</td>
  <td class="name">${esc(it.name)}</td>
  <td class="r">${esc(unitQty(it))}</td>
  <td class="r">${money(it.rate)}</td>
  <td class="r">${money(it.line_total)}</td>
</tr>`
    )
    .join('');

  return `<div class="doc-head">
  <div class="co">
    <h1>${esc(shop.shop_name || 'Shop')}</h1>
    <p>${esc(shop.shop_address || '')}${shop.shop_phone ? `<br />${esc(shop.shop_phone)}` : ''}</p>
  </div>
  <div class="meta">
    <p class="title">STATEMENT</p>
    <p class="line">Period: ${esc(periodLabel(ctx))}</p>
    <p class="line">Generated: ${esc(fmtDate(new Date().toISOString()))}</p>
  </div>
</div>

<div class="party">
  <h3>Account of</h3>
  <div class="big">${esc(customer.name)}</div>
  ${customer.phone ? `<div class="sub">Phone: ${esc(customer.phone)}</div>` : ''}
  ${customer.address ? `<div class="sub">${esc(customer.address)}</div>` : ''}
</div>
${summaryStrip(ctx)}

<h2 class="sec">Account activity</h2>
<table class="ledger">
  <thead>
    <tr>
      <th style="width:30mm">Date</th>
      <th>Particulars</th>
      <th class="r" style="width:26mm">Debit</th>
      <th class="r" style="width:26mm">Credit</th>
      <th class="r" style="width:30mm">Balance</th>
    </tr>
    <tr><td colspan="4" style="font-size:8.5pt;color:#64748b">Opening balance</td><td class="r" style="font-variant-numeric:tabular-nums">${money(statement.opening_balance)}</td></tr>
  </thead>
  <tbody>${ledgerRows || '<tr><td colspan="5" style="color:#94a3b8">No transactions in this period.</td></tr>'}</tbody>
</table>

${
  showItems
    ? `<h2 class="sec">Items taken on credit</h2>
<table class="items-detail">
  <thead>
    <tr><th style="width:30mm">Date</th><th style="width:30mm">Invoice</th><th>Item</th><th class="r" style="width:24mm">Qty</th><th class="r" style="width:24mm">Rate</th><th class="r" style="width:28mm">Amount</th></tr>
  </thead>
  <tbody>${itemRows}</tbody>
</table>`
    : ''
}

<div class="terms">
  <b>Note</b><br />
  This is a statement of account, not a demand for payment. Please report any discrepancy within 7 days.
  Balance shown is as of the generated date.
</div>
<div class="doc-foot">${esc(shop.receipt_footer_text || 'Thank you for your business')}</div>`;
}

// ═══════════════════════════════════════════════════════════════════
//  80 / 58 mm STATEMENT
// ═══════════════════════════════════════════════════════════════════

function rollCss(paper: 'thermal80' | 'thermal58'): string {
  const content = paper === 'thermal80' ? 72 : 48;
  const base = paper === 'thermal80' ? 12 : 10;
  return `
@page { size: ${paper === 'thermal80' ? 80 : 58}mm auto; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #fff; }
body {
  width: ${content}mm; margin: 0 auto; padding: 2mm 1mm;
  font-family: Arial, Tahoma, sans-serif; font-size: ${base}px; color: #000; font-weight: 600;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
.center { text-align: center; }
.shop { font-size: ${base + 8}px; font-weight: 800; }
.muted { color: #000; font-weight: 500; font-size: ${base - 1}px; }
.rule { border-top: 1px dashed #000; margin: 1.6mm 0; }
.title { font-size: ${base + 4}px; font-weight: 800; letter-spacing: 0.6px; }
.kv { display: flex; justify-content: space-between; gap: 2mm; }
.kv span:last-child { text-align: right; font-variant-numeric: tabular-nums; }
.row { padding: 0.6mm 0; }
.row .line1 { display: flex; justify-content: space-between; gap: 2mm; }
.row .line2 { font-weight: 500; font-size: ${base - 1}px; }
.amt { font-variant-numeric: tabular-nums; }
.big { font-size: ${base + 3}px; font-weight: 800; }
.tag { font-size: ${base - 2}px; font-weight: 700; }
.tag.due { color: #b91c1c; }
`;
}

function rollBody(ctx: StatementContext): string {
  const { customer, statement, shop, money } = ctx;

  const rows = statement.rows
    .map((r) => {
      const amt = r.amount < 0 ? `-${money(Math.abs(r.amount))}` : money(r.amount);
      const tag = r.overdue ? ' <span class="tag due">OVERDUE</span>' : '';
      return `<div class="row">
  <div class="line1"><span>${esc(particulars(r))}${tag}</span><span class="amt">${amt}</span></div>
  <div class="line2">${esc(fmtDate(r.created_at))} &nbsp; Bal ${money(r.running)}</div>
</div>`;
    })
    .join('');

  const items = statement.items.length
    ? `<div class="rule"></div>
<div class="title">ITEMS TAKEN</div>
${statement.items
  .map(
    (it) => `<div class="row">
  <div class="line1"><span>${esc(it.name)}</span><span class="amt">${money(it.line_total)}</span></div>
  <div class="line2">${esc(fmtDate(it.created_at))} &nbsp; ${esc(unitQty(it))} x ${money(it.rate)}${it.invoice_no ? ` &nbsp; ${esc(it.invoice_no)}` : ''}</div>
</div>`
  )
  .join('')}`
    : '';

  return `<div class="center">
  <div class="shop">${esc(shop.shop_name || 'Shop')}</div>
  ${shop.shop_phone ? `<div class="muted">${esc(shop.shop_phone)}</div>` : ''}
  <div class="title">ACCOUNT STATEMENT</div>
</div>
<div class="rule"></div>
<div class="kv"><span>Customer</span><span>${esc(customer.name)}</span></div>
${customer.phone ? `<div class="kv"><span>Phone</span><span>${esc(customer.phone)}</span></div>` : ''}
<div class="kv"><span>Period</span><span>${esc(periodLabel(ctx))}</span></div>
<div class="rule"></div>
<div class="kv"><span>Opening balance</span><span class="amt">${money(statement.opening_balance)}</span></div>
<div class="rule"></div>
${rows || '<div class="row muted">No transactions in this period.</div>'}
<div class="rule"></div>
<div class="kv big"><span>CLOSING BALANCE</span><span class="amt">${money(statement.closing_balance)}</span></div>
<div class="rule"></div>
${items}
${items ? '<div class="rule"></div>' : ''}
<div class="center muted">${esc(shop.receipt_footer_text || 'Thank you for your business')}</div>
<div class="center muted">Generated ${esc(fmtDate(new Date().toISOString()))}</div>`;
}

export function statementHtml(ctx: StatementContext, paperInput?: StatementPaper): { html: string; paper: StatementPaper } {
  const paper = resolvePaper(paperInput);
  if (paper === 'a4') {
    const html = htmlDocument(`Statement — ${ctx.customer.name}`, a4Css(ctx.statement.items.length > 0), a4Body(ctx));
    return { html, paper };
  }
  const html = htmlDocument(`Statement — ${ctx.customer.name}`, rollCss(paper), rollBody(ctx));
  return { html, paper };
}

export function buildStatementJob(
  customerId: number,
  from?: string,
  to?: string,
  paperInput?: StatementPaper
): PrintJob {
  const ctx = buildStatementContext(customerId, from, to);
  const { html, paper } = statementHtml(ctx, paperInput);
  return {
    html,
    paper,
    printerKey: paper === 'a4' ? 'invoice' : 'receipt',
    jobName: `Statement — ${ctx.customer.name}`,
  };
}

export async function printStatement(
  customerId: number,
  from?: string,
  to?: string,
  paper?: StatementPaper
): Promise<PrintResult> {
  return printDocument(buildStatementJob(customerId, from, to, paper));
}

export async function previewStatement(
  customerId: number,
  from?: string,
  to?: string,
  paper?: StatementPaper
): Promise<PrintResult> {
  return previewDocument(buildStatementJob(customerId, from, to, paper), {
    title: 'Statement preview',
    printButtonLabel: 'Print statement',
  });
}

/** Render the statement to PDF bytes (the "Export PDF" button). */
export async function exportStatementPdf(
  customerId: number,
  from?: string,
  to?: string,
  paper?: StatementPaper
): Promise<{ ok: boolean; message: string; data?: Uint8Array }> {
  try {
    const { data } = await printJobToPdf(buildStatementJob(customerId, from, to, paper));
    return { ok: true, message: 'Statement PDF ready.', data: new Uint8Array(data) };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

/** Plain-text statement for WhatsApp. */
export function statementText(customerId: number, from?: string, to?: string): string {
  const ctx = buildStatementContext(customerId, from, to);
  const { customer, statement, shop, money } = ctx;
  const lines: string[] = [];
  lines.push(`${shop.shop_name || 'Shop'} — Account Statement`);
  lines.push(`Customer: ${customer.name}`);
  lines.push(`Period: ${periodLabel(ctx)}`);
  lines.push('');
  lines.push(`Opening balance: ${money(statement.opening_balance)}`);
  for (const r of statement.rows) {
    const amt = r.amount < 0 ? `-${money(Math.abs(r.amount))}` : `+${money(r.amount)}`;
    lines.push(`${dateOnly(r.created_at) || ''}  ${particulars(r)}  ${amt}`);
  }
  lines.push('');
  if (statement.items.length) {
    lines.push('Items taken on credit:');
    for (const it of statement.items) {
      lines.push(`  ${dateOnly(it.created_at) || ''}  ${it.name}  ${unitQty(it)} x ${money(it.rate)} = ${money(it.line_total)}`);
    }
    lines.push('');
  }
  lines.push(`Closing balance: ${money(statement.closing_balance)}`);
  return lines.join('\n');
}

function dateOnly(ts: string | null | undefined): string | null {
  if (!ts) return null;
  return String(ts).slice(0, 10);
}

// ═══════════════════════════════════════════════════════════════════
//  ENTRY CREDIT SLIP (one manual 'Udhaar (items)' entry)
// ═══════════════════════════════════════════════════════════════════

function entrySlipTitle(direction: 'debit' | 'credit'): string {
  return direction === 'credit' ? 'ITEMS RETURNED' : 'UDHAAR (ITEMS)';
}

function entrySlipBody(entry: UdhaarEntryDetail, shop: Record<string, string>, money: (n: number) => string): string {
  const rows = entry.items
    .map((it) => {
      const meta = [
        `${esc(unitQty(it))} x ${money(it.rate)}`,
        it.discount ? `disc ${money(it.discount)}` : '',
        it.batch ? `B:${esc(it.batch)}` : '',
        it.expiry ? `E:${esc(it.expiry)}` : '',
      ]
        .filter(Boolean)
        .join(' &nbsp; ');
      return `<div class="row">
  <div class="line1"><span>${esc(it.name)}</span><span class="amt">${money(it.line_total)}</span></div>
  <div class="line2">${meta}</div>
</div>`;
    })
    .join('');

  const sign = entry.direction === 'credit' ? '-' : '';
  return `<div class="center">
  <div class="shop">${esc(shop.shop_name || 'Shop')}</div>
  ${shop.shop_phone ? `<div class="muted">${esc(shop.shop_phone)}</div>` : ''}
  <div class="title">${entrySlipTitle(entry.direction)}</div>
</div>
<div class="rule"></div>
<div class="kv"><span>Customer</span><span>${esc(entry.customer.name)}</span></div>
${entry.customer.phone ? `<div class="kv"><span>Phone</span><span>${esc(entry.customer.phone)}</span></div>` : ''}
<div class="kv"><span>Date</span><span>${esc(fmtDate(entry.created_at))}</span></div>
${entry.reference ? `<div class="kv"><span>Reference</span><span>${esc(entry.reference)}</span></div>` : ''}
<div class="rule"></div>
${rows || '<div class="row muted">No items.</div>'}
<div class="rule"></div>
<div class="kv big"><span>TOTAL</span><span class="amt">${sign}${money(entry.total)}</span></div>
<div class="kv"><span>Balance after</span><span class="amt">${money(entry.customer.balance)}</span></div>
${entry.note ? `<div class="rule"></div><div class="muted">Note: ${esc(entry.note)}</div>` : ''}
<div class="rule"></div>
<div class="center muted">${esc(shop.receipt_footer_text || 'Thank you for your business')}</div>`;
}

/** A roll (thermal) credit slip for one manual entry. */
export function buildEntrySlipJob(transactionId: number, paper?: 'thermal80' | 'thermal58'): PrintJob {
  const entry = getUdhaarEntry(transactionId);
  if (!entry) throw new Error('Entry not found');
  const roll: 'thermal80' | 'thermal58' = paper === 'thermal58' ? 'thermal58' : 'thermal80';
  const shop = getPrintSettings();
  const money = makeMoney(shop.currency || 'Rs');
  const html = htmlDocument(`Udhaar slip — ${entry.customer.name}`, rollCss(roll), entrySlipBody(entry, shop, money));
  return { html, paper: roll, printerKey: 'receipt', jobName: `Udhaar slip — ${entry.customer.name}` };
}

export async function printEntrySlip(transactionId: number, paper?: 'thermal80' | 'thermal58'): Promise<PrintResult> {
  return printDocument(buildEntrySlipJob(transactionId, paper));
}

/** Plain-text credit slip for WhatsApp. */
export function entrySlipText(transactionId: number): string {
  const entry = getUdhaarEntry(transactionId);
  if (!entry) return '';
  const shop = getPrintSettings();
  const money = makeMoney(shop.currency || 'Rs');
  const lines: string[] = [];
  lines.push(`${shop.shop_name || 'Shop'} — ${entry.direction === 'credit' ? 'Items Returned' : 'Udhaar (Items)'}`);
  lines.push(`Customer: ${entry.customer.name}`);
  lines.push(`Date: ${dateOnly(entry.created_at) || ''}`);
  if (entry.reference) lines.push(`Reference: ${entry.reference}`);
  lines.push('');
  for (const it of entry.items) {
    lines.push(`${it.name}  ${unitQty(it)} x ${money(it.rate)} = ${money(it.line_total)}`);
  }
  lines.push('');
  lines.push(`Total: ${entry.direction === 'credit' ? '-' : ''}${money(entry.total)}`);
  lines.push(`Balance: ${money(entry.customer.balance)}`);
  if (entry.note) lines.push(`Note: ${entry.note}`);
  return lines.join('\n');
}
