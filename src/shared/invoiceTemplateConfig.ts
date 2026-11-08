/**
 * Shared invoice-template config helpers.
 *
 * `InvoiceTemplateRow.config_json` is persisted JSON. Both the main process
 * (which creates/updates templates) and the renderer (which previews them)
 * need the same defaults and the same forward-compatible coercion, so the
 * logic lives here instead of being duplicated in the service and the page.
 */
import type { TemplateConfig } from './types';

export const DEFAULT_TEMPLATE_CONFIG: TemplateConfig = {
  showLogo: true,
  showShopName: true,
  showShopAddress: true,
  showShopPhone: true,
  showInvoiceNo: true,
  showDate: true,
  showCustomer: true,
  showItemsTable: true,
  showTotals: true,
  showPaymentInfo: true,
  showFooter: true,
  boldInvoiceNo: true,
  boldTotal: true,
  boldGrandTotal: true,
  fontSize: 12,
  primaryColor: '#DC3545',
  footerText: 'Thank you for your business!',
  headerLines: [],
  customFields: {},
};

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function str(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

/**
 * Turn unknown JSON into a complete config. Missing/incorrect fields fall back
 * to the shipped defaults, and unknown fields (from a newer build) are dropped
 * rather than leaking into `<style>`/JSX.
 */
export function normalizeTemplateConfig(raw: unknown): TemplateConfig {
  const cfg = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    showLogo: bool(cfg.showLogo, DEFAULT_TEMPLATE_CONFIG.showLogo),
    showShopName: bool(cfg.showShopName, DEFAULT_TEMPLATE_CONFIG.showShopName),
    showShopAddress: bool(cfg.showShopAddress, DEFAULT_TEMPLATE_CONFIG.showShopAddress),
    showShopPhone: bool(cfg.showShopPhone, DEFAULT_TEMPLATE_CONFIG.showShopPhone),
    showInvoiceNo: bool(cfg.showInvoiceNo, DEFAULT_TEMPLATE_CONFIG.showInvoiceNo),
    showDate: bool(cfg.showDate, DEFAULT_TEMPLATE_CONFIG.showDate),
    showCustomer: bool(cfg.showCustomer, DEFAULT_TEMPLATE_CONFIG.showCustomer),
    showItemsTable: bool(cfg.showItemsTable, DEFAULT_TEMPLATE_CONFIG.showItemsTable),
    showTotals: bool(cfg.showTotals, DEFAULT_TEMPLATE_CONFIG.showTotals),
    showPaymentInfo: bool(cfg.showPaymentInfo, DEFAULT_TEMPLATE_CONFIG.showPaymentInfo),
    showFooter: bool(cfg.showFooter, DEFAULT_TEMPLATE_CONFIG.showFooter),
    boldInvoiceNo: bool(cfg.boldInvoiceNo, DEFAULT_TEMPLATE_CONFIG.boldInvoiceNo),
    boldTotal: bool(cfg.boldTotal, DEFAULT_TEMPLATE_CONFIG.boldTotal),
    boldGrandTotal: bool(cfg.boldGrandTotal, DEFAULT_TEMPLATE_CONFIG.boldGrandTotal),
    fontSize: Math.min(32, Math.max(6, num(cfg.fontSize, DEFAULT_TEMPLATE_CONFIG.fontSize))),
    primaryColor: str(cfg.primaryColor, DEFAULT_TEMPLATE_CONFIG.primaryColor),
    footerText: str(cfg.footerText, DEFAULT_TEMPLATE_CONFIG.footerText),
    headerLines: Array.isArray(cfg.headerLines)
      ? cfg.headerLines.filter((line): line is string => typeof line === 'string')
      : [],
    customFields:
      cfg.customFields && typeof cfg.customFields === 'object'
        ? (cfg.customFields as Record<string, string>)
        : {},
  };
}

/** Parse a persisted `config_json` string without ever throwing. */
export function parseTemplateConfig(json: string | null | undefined): TemplateConfig {
  if (!json) return normalizeTemplateConfig(null);
  try {
    return normalizeTemplateConfig(JSON.parse(json));
  } catch {
    return normalizeTemplateConfig(null);
  }
}
