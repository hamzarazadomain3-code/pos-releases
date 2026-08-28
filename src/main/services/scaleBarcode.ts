import { getDb } from '../db';
import type { Product } from '../../shared/types';
import { getProductByBarcode } from './inventory';

export interface ScaleBarcodeResult {
  plu: string;
  price: number;
  isValid: boolean;
  error?: string;
}

export interface ScalePluMapping {
  plu: string;
  product_id: number;
  product_name: string;
}

const SCALE_PREFIX = '21';

/**
 * Validate the EAN-13 check digit (standard modulo-10 algorithm).
 * The first 12 digits are the payload; digit 13 is the check digit.
 */
export function isValidEan13(barcode: string): boolean {
  if (!/^\d{13}$/.test(barcode)) return false;
  const sum = barcode
    .slice(0, 12)
    .split('')
    .reduce((acc, ch, i) => acc + Number(ch) * (i % 2 === 0 ? 1 : 3), 0);
  const check = (10 - (sum % 10)) % 10;
  return check === Number(barcode[12]);
}

/**
 * Check if a 13-digit barcode starts with the BayLan scale prefix "21".
 */
export function isScaleBarcode(barcode: string): boolean {
  return barcode.length === 13 && barcode.startsWith(SCALE_PREFIX);
}

/**
 * Parse a BayLan RLS1100 label barcode.
 *
 * Format: 21 | PPPPP | PPPPP | C
 *   Positions (0-indexed): [0-1]="21" prefix | [2-6]=PLU (5 digits) | [7-11]=Price (5 digits) | [12]=check digit
 *
 * Example: 2110001002342 → prefix="21", PLU="10001", Price=234, check=2
 */
export function parseBayLanBarcode(barcode: string): ScaleBarcodeResult {
  console.log(`[ScaleBarcode] parseBayLanBarcode("${barcode}") length=${barcode.length}`);
  if (!/^\d{13}$/.test(barcode)) {
    console.log(`[ScaleBarcode] REJECTED: not 13 numeric digits`);
    return { plu: '', price: 0, isValid: false, error: 'Barcode must be 13 numeric digits' };
  }

  if (!barcode.startsWith(SCALE_PREFIX)) {
    console.log(`[ScaleBarcode] REJECTED: does not start with "${SCALE_PREFIX}"`);
    return { plu: '', price: 0, isValid: false, error: `Barcode does not start with scale prefix "${SCALE_PREFIX}"` };
  }

  if (!isValidEan13(barcode)) {
    console.log(`[ScaleBarcode] REJECTED: invalid EAN-13 checksum`);
    return { plu: '', price: 0, isValid: false, error: 'Invalid EAN-13 checksum' };
  }

  const plu = barcode.substring(2, 7);
  const priceStr = barcode.substring(7, 12);
  const price = parseInt(priceStr, 10);

  if (isNaN(price) || price <= 0) {
    console.log(`[ScaleBarcode] REJECTED: decoded price is zero or invalid (priceStr="${priceStr}")`);
    return { plu, price: 0, isValid: false, error: 'Decoded price is zero or invalid' };
  }

  console.log(`[ScaleBarcode] VALID: plu="${plu}" price=${price}`);
  return { plu, price, isValid: true };
}

/**
 * Look up a product by PLU code stored in the product's barcode or SKU field.
 */
export function getProductByPlu(plu: string): Product | null {
  return getProductByBarcode(plu);
}

/**
 * Return all products that have a PLU stored in their barcode or SKU field.
 * Used by the Settings UI to show existing PLU mappings.
 */
export function listPluMappings(): ScalePluMapping[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT p.id AS product_id, p.name AS product_name, p.barcode, p.sku
       FROM products p
       WHERE p.active = 1 AND (p.barcode IS NOT NULL AND length(p.barcode) = 5)
       ORDER BY p.name COLLATE NOCASE`
    )
    .all() as unknown as Array<{ product_id: number; product_name: string; barcode: string | null; sku: string | null }>;

  return rows
    .map((r) => ({
      plu: r.barcode ?? '',
      product_id: r.product_id,
      product_name: r.product_name,
    }))
    .filter((r) => r.plu !== '' && r.plu.startsWith('1') && /^\d{5}$/.test(r.plu));
}
