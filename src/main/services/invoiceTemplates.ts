import { getDb } from '../db';
import { logError } from '../logger';

export interface InvoiceTemplateRow {
  id: number;
  name: string;
  type: 'sale' | 'purchase' | 'quotation' | 'payment' | 'return';
  paper_size: 'a4' | 'a5' | 'thermal58' | 'thermal80';
  orientation: 'portrait' | 'landscape';
  margin_top: number;
  margin_bottom: number;
  margin_left: number;
  margin_right: number;
  config_json: string;
  is_default: number;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface TemplateConfig {
  showLogo: boolean;
  showShopName: boolean;
  showShopAddress: boolean;
  showShopPhone: boolean;
  showInvoiceNo: boolean;
  showDate: boolean;
  showCustomer: boolean;
  showItemsTable: boolean;
  showTotals: boolean;
  showPaymentInfo: boolean;
  showFooter: boolean;
  boldInvoiceNo: boolean;
  boldTotal: boolean;
  boldGrandTotal: boolean;
  fontSize: number;
  primaryColor: string;
  footerText: string;
  headerLines: string[];
  customFields?: Record<string, string>;
}

export function listTemplates(type?: string): InvoiceTemplateRow[] {
  try {
    const db = getDb();
    if (type) {
      return db.prepare(`SELECT * FROM invoice_templates WHERE type = ? AND is_active = 1 ORDER BY is_default DESC, name`).all(type) as unknown as InvoiceTemplateRow[];
    }
    return db.prepare(`SELECT * FROM invoice_templates WHERE is_active = 1 ORDER BY type, is_default DESC, name`).all() as unknown as InvoiceTemplateRow[];
  } catch (e) {
    logError('listTemplates', e);
    return [];
  }
}

export function getTemplate(id: number): InvoiceTemplateRow | null {
  try {
    const db = getDb();
    return db.prepare(`SELECT * FROM invoice_templates WHERE id = ?`).get(id) as unknown as InvoiceTemplateRow | null;
  } catch (e) {
    logError('getTemplate', e);
    return null;
  }
}

export function getDefaultTemplate(type: string): InvoiceTemplateRow | null {
  try {
    const db = getDb();
    return db.prepare(`SELECT * FROM invoice_templates WHERE type = ? AND is_default = 1 AND is_active = 1 LIMIT 1`).get(type) as unknown as InvoiceTemplateRow | null;
  } catch (e) {
    logError('getDefaultTemplate', e);
    return null;
  }
}

export function getTemplateConfig(template: InvoiceTemplateRow): TemplateConfig {
  try {
    const cfg = JSON.parse(template.config_json);
    return {
      showLogo: cfg.showLogo ?? true,
      showShopName: cfg.showShopName ?? true,
      showShopAddress: cfg.showShopAddress ?? true,
      showShopPhone: cfg.showShopPhone ?? true,
      showInvoiceNo: cfg.showInvoiceNo ?? true,
      showDate: cfg.showDate ?? true,
      showCustomer: cfg.showCustomer ?? true,
      showItemsTable: cfg.showItemsTable ?? true,
      showTotals: cfg.showTotals ?? true,
      showPaymentInfo: cfg.showPaymentInfo ?? true,
      showFooter: cfg.showFooter ?? true,
      boldInvoiceNo: cfg.boldInvoiceNo ?? true,
      boldTotal: cfg.boldTotal ?? true,
      boldGrandTotal: cfg.boldGrandTotal ?? true,
      fontSize: cfg.fontSize ?? 12,
      primaryColor: cfg.primaryColor ?? '#DC3545',
      footerText: cfg.footerText ?? 'Thank you for your business!',
      headerLines: cfg.headerLines ?? [],
      customFields: cfg.customFields ?? {},
    };
  } catch {
    return {
      showLogo: true, showShopName: true, showShopAddress: true, showShopPhone: true,
      showInvoiceNo: true, showDate: true, showCustomer: true, showItemsTable: true,
      showTotals: true, showPaymentInfo: true, showFooter: true,
      boldInvoiceNo: true, boldTotal: true, boldGrandTotal: true,
      fontSize: 12, primaryColor: '#DC3545', footerText: 'Thank you!', headerLines: [],
    };
  }
}

export function createTemplate(input: {
  name: string;
  type: string;
  paper_size?: string;
  orientation?: string;
  margin_top?: number;
  margin_bottom?: number;
  margin_left?: number;
  margin_right?: number;
  config: TemplateConfig;
  is_default?: boolean;
}): { ok: boolean; id?: number; message?: string } {
  try {
    const db = getDb();
    if (input.is_default) {
      db.prepare(`UPDATE invoice_templates SET is_default = 0 WHERE type = ?`).run(input.type);
    }
    const res = db.prepare(`
      INSERT INTO invoice_templates (name, type, paper_size, orientation, margin_top, margin_bottom, margin_left, margin_right, config_json, is_default)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.name, input.type,
      input.paper_size || 'a4', input.orientation || 'portrait',
      input.margin_top ?? 10, input.margin_bottom ?? 10, input.margin_left ?? 10, input.margin_right ?? 10,
      JSON.stringify(input.config),
      input.is_default ? 1 : 0
    );
    return { ok: true, id: Number(res.lastInsertRowid) };
  } catch (e) {
    logError('createTemplate', e);
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

export function updateTemplate(id: number, input: Partial<{
  name: string;
  paper_size: string;
  orientation: string;
  margin_top: number;
  margin_bottom: number;
  margin_left: number;
  margin_right: number;
  config: TemplateConfig;
  is_default: boolean;
  is_active: boolean;
}>): { ok: boolean; message?: string } {
  try {
    const db = getDb();
    const t = db.prepare(`SELECT * FROM invoice_templates WHERE id = ?`).get(id) as unknown as InvoiceTemplateRow | undefined;
    if (!t) return { ok: false, message: 'Template not found' };

    if (input.is_default) {
      db.prepare(`UPDATE invoice_templates SET is_default = 0 WHERE type = ?`).run(t.type);
    }

    const fields: string[] = [];
    const vals: any[] = [];
    if (input.name !== undefined) { fields.push('name = ?'); vals.push(input.name); }
    if (input.paper_size !== undefined) { fields.push('paper_size = ?'); vals.push(input.paper_size); }
    if (input.orientation !== undefined) { fields.push('orientation = ?'); vals.push(input.orientation); }
    if (input.margin_top !== undefined) { fields.push('margin_top = ?'); vals.push(input.margin_top); }
    if (input.margin_bottom !== undefined) { fields.push('margin_bottom = ?'); vals.push(input.margin_bottom); }
    if (input.margin_left !== undefined) { fields.push('margin_left = ?'); vals.push(input.margin_left); }
    if (input.margin_right !== undefined) { fields.push('margin_right = ?'); vals.push(input.margin_right); }
    if (input.config !== undefined) { fields.push('config_json = ?'); vals.push(JSON.stringify(input.config)); }
    if (input.is_default !== undefined) { fields.push('is_default = ?'); vals.push(input.is_default ? 1 : 0); }
    if (input.is_active !== undefined) { fields.push('is_active = ?'); vals.push(input.is_active ? 1 : 0); }

    fields.push(`updated_at = datetime('now', 'utc') || 'Z'`);
    vals.push(id);

    db.prepare(`UPDATE invoice_templates SET ${fields.join(', ')} WHERE id = ?`).run(...vals);
    return { ok: true };
  } catch (e) {
    logError('updateTemplate', e);
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

export function deleteTemplate(id: number): { ok: boolean; message?: string } {
  try {
    const db = getDb();
    const t = db.prepare(`SELECT * FROM invoice_templates WHERE id = ?`).get(id) as unknown as InvoiceTemplateRow | undefined;
    if (!t) return { ok: false, message: 'Template not found' };
    db.prepare(`DELETE FROM invoice_templates WHERE id = ?`).run(id);
    return { ok: true };
  } catch (e) {
    logError('deleteTemplate', e);
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Duplicate a template — useful for "Save as new".
 */
export function duplicateTemplate(id: number, newName: string): { ok: boolean; new_id?: number; message?: string } {
  try {
    const t = getTemplate(id);
    if (!t) return { ok: false, message: 'Template not found' };
    const cfg = getTemplateConfig(t);
    return createTemplate({
      name: newName,
      type: t.type,
      paper_size: t.paper_size,
      orientation: t.orientation,
      margin_top: t.margin_top,
      margin_bottom: t.margin_bottom,
      margin_left: t.margin_left,
      margin_right: t.margin_right,
      config: cfg,
      is_default: false,
    });
  } catch (e) {
    logError('duplicateTemplate', e);
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

export const invoiceTemplatesService = {
  list: listTemplates,
  get: getTemplate,
  getDefault: getDefaultTemplate,
  getConfig: getTemplateConfig,
  create: createTemplate,
  update: updateTemplate,
  delete: deleteTemplate,
  duplicate: duplicateTemplate,
};
