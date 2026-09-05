import { getDb } from '../db';
import { logError } from '../logger';

export interface PartyTransferRow {
  id: number;
  from_party_id: number;
  from_party_type: 'customer' | 'supplier';
  from_party_name?: string;
  to_party_id: number;
  to_party_type: 'customer' | 'supplier';
  to_party_name?: string;
  amount: number;
  reference: string | null;
  notes: string | null;
  created_by: number | null;
  created_by_name?: string;
  created_at: string;
}

export interface BankAccountRow {
  id: number;
  name: string;
  bank_name: string | null;
  account_number: string | null;
  iban: string | null;
  branch: string | null;
  currency: string;
  current_balance: number;
  is_active: number;
  is_default?: number;
  created_at: string;
}

export interface BankTransferRow {
  id: number;
  from_account_id: number;
  from_account_name?: string;
  to_account_id: number;
  to_account_name?: string;
  amount: number;
  reference: string | null;
  notes: string | null;
  created_by: number | null;
  created_by_name?: string;
  created_at: string;
}

function getCustomerName(id: number): string | null {
  try {
    return getDb().prepare(`SELECT name FROM customers WHERE id = ?`).get(id) as any;
  } catch { return null; }
}

function getSupplierName(id: number): string | null {
  try {
    return getDb().prepare(`SELECT name FROM suppliers WHERE id = ?`).get(id) as any;
  } catch { return null; }
}

export function listPartyTransfers(limit = 200): PartyTransferRow[] {
  try {
    return getDb().prepare(`
      SELECT pt.*, u.username as created_by_name
      FROM party_transfers pt
      LEFT JOIN users u ON pt.created_by = u.id
      ORDER BY pt.created_at DESC LIMIT ?
    `).all(limit) as unknown as PartyTransferRow[];
  } catch (e) {
    logError('listPartyTransfers', e);
    return [];
  }
}

export function createPartyTransfer(input: {
  from_party_id: number;
  from_party_type: 'customer' | 'supplier';
  to_party_id: number;
  to_party_type: 'customer' | 'supplier';
  amount: number;
  reference?: string;
  notes?: string;
  created_by: number;
}): { ok: boolean; message?: string } {
  try {
    const db = getDb();
    if (input.amount <= 0) return { ok: false, message: 'Amount must be positive' };
    if (input.from_party_id === input.to_party_id && input.from_party_type === input.to_party_type) {
      return { ok: false, message: 'Cannot transfer to same party' };
    }

    db.exec('BEGIN');
    try {
      db.prepare(`
        INSERT INTO party_transfers (from_party_id, from_party_type, to_party_id, to_party_type, amount, reference, notes, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        input.from_party_id, input.from_party_type, input.to_party_id, input.to_party_type,
        input.amount, input.reference || null, input.notes || null, input.created_by
      );

      // Update party balances
      if (input.from_party_type === 'customer') {
        db.prepare(`UPDATE customers SET balance = balance - ? WHERE id = ?`).run(input.amount, input.from_party_id);
      } else {
        db.prepare(`UPDATE suppliers SET balance = balance - ? WHERE id = ?`).run(input.amount, input.from_party_id);
      }
      if (input.to_party_type === 'customer') {
        db.prepare(`UPDATE customers SET balance = balance + ? WHERE id = ?`).run(input.amount, input.to_party_id);
      } else {
        db.prepare(`UPDATE suppliers SET balance = balance + ? WHERE id = ?`).run(input.amount, input.to_party_id);
      }

      // Add to customer/supplier transactions
      db.prepare(`
        INSERT INTO customer_transactions (customer_id, amount, type, created_at)
        VALUES (?, ?, 'transfer_out', datetime('now', 'utc') || 'Z')
      `).run(input.from_party_type === 'customer' ? input.from_party_id : input.to_party_id);

      db.exec('COMMIT');
    } catch (txErr) {
      db.exec('ROLLBACK');
      throw txErr;
    }
    return { ok: true };
  } catch (e) {
    logError('createPartyTransfer', e);
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

export function listBankAccounts(): BankAccountRow[] {
  try {
    return getDb().prepare(`SELECT * FROM bank_accounts WHERE is_active = 1 ORDER BY is_default DESC, name`).all() as unknown as BankAccountRow[];
  } catch (e) { logError('listBankAccounts', e); return []; }
}

export function getBankAccount(id: number): BankAccountRow | null {
  try { return getDb().prepare(`SELECT * FROM bank_accounts WHERE id = ?`).get(id) as unknown as BankAccountRow | null; } catch { return null; }
}

export function createBankAccount(input: {
  name: string;
  bank_name?: string;
  account_number?: string;
  iban?: string;
  branch?: string;
  currency?: string;
}): { ok: boolean; id?: number; message?: string } {
  try {
    const db = getDb();
    const count = db.prepare(`SELECT COUNT(*) as c FROM bank_accounts`).get() as any;
    const isDefault = count.c === 0;
    const res = db.prepare(`
      INSERT INTO bank_accounts (name, bank_name, account_number, iban, branch, currency, current_balance, is_active, is_default)
      VALUES (?, ?, ?, ?, ?, ?, 0, 1, ?)
    `).run(input.name, input.bank_name || null, input.account_number || null, input.iban || null, input.branch || null, input.currency || 'PKR', isDefault ? 1 : 0);
    if (isDefault) db.prepare(`UPDATE settings SET value = ? WHERE key = 'default_bank_account_id'`).run(String(res.lastInsertRowid));
    return { ok: true, id: Number(res.lastInsertRowid) };
  } catch (e) { logError('createBankAccount', e); return { ok: false, message: String(e) }; }
}

export function listBankTransfers(limit = 200): BankTransferRow[] {
  try {
    return getDb().prepare(`
      SELECT bt.*, u.username as created_by_name
      FROM bank_transfers bt
      LEFT JOIN users u ON bt.created_by = u.id
      ORDER BY bt.created_at DESC LIMIT ?
    `).all(limit) as unknown as BankTransferRow[];
  } catch (e) { logError('listBankTransfers', e); return []; }
}

export function createBankTransfer(input: {
  from_account_id: number;
  to_account_id: number;
  amount: number;
  reference?: string;
  notes?: string;
  created_by: number;
}): { ok: boolean; message?: string } {
  try {
    const db = getDb();
    if (input.amount <= 0) return { ok: false, message: 'Amount must be positive' };
    if (input.from_account_id === input.to_account_id) return { ok: false, message: 'Cannot transfer to same account' };

    db.exec('BEGIN');
    try {
      db.prepare(`
        INSERT INTO bank_transfers (from_account_id, to_account_id, amount, reference, notes, created_by)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(input.from_account_id, input.to_account_id, input.amount, input.reference || null, input.notes || null, input.created_by);

      db.prepare(`UPDATE bank_accounts SET current_balance = current_balance - ? WHERE id = ?`).run(input.amount, input.from_account_id);
      db.prepare(`UPDATE bank_accounts SET current_balance = current_balance + ? WHERE id = ?`).run(input.amount, input.to_account_id);

      db.exec('COMMIT');
    } catch (txErr) {
      db.exec('ROLLBACK');
      throw txErr;
    }
    return { ok: true };
  } catch (e) { logError('createBankTransfer', e); return { ok: false, message: String(e) }; }
}

export const transfersService = {
  listPartyTransfers,
  createPartyTransfer,
  listBankAccounts,
  getBankAccount,
  createBankAccount,
  listBankTransfers,
  createBankTransfer,
};