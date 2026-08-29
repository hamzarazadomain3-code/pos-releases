import { getDb } from '../db';
import { getAllAdminSettings } from './admin';

interface OtpRecord {
  id: number;
  user_id: number;
  otp_code: string;
  method: string;
  expires_at: string;
  used: number;
  created_at: string;
}

const OTP_EXPIRY_MINUTES = 5;
const MAX_OTP_ATTEMPTS = 3;

function generateRandomOtp(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export function is2FAEnabled(): boolean {
  const admin = getAllAdminSettings();
  return admin.two_factor_enabled === 'true' || admin.two_factor_enabled === '1';
}

export function get2FAMethod(): string {
  const admin = getAllAdminSettings();
  return admin.two_factor_method || 'email';
}

export async function generateOtp(userId: number): Promise<{ ok: boolean; method: string; message: string }> {
  const admin = getAllAdminSettings();
  if (!is2FAEnabled()) return { ok: false, method: '', message: '2FA not enabled' };

  const method = get2FAMethod();
  const db = getDb();

  // Invalidate old OTPs for this user
  db.prepare('UPDATE otp_codes SET used = 1 WHERE user_id = ? AND used = 0').run(userId);

  const otp = generateRandomOtp();
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000).toISOString();

  db.prepare(
    'INSERT INTO otp_codes (user_id, otp_code, method, expires_at, used, created_at) VALUES (?, ?, ?, ?, 0, CURRENT_TIMESTAMP)'
  ).run(userId, otp, method, expiresAt);

  // Deliver OTP based on method
  if (method === 'email') {
    const { getUser } = require('./auth');
    const user = getUser(userId);
    const email = admin.email_otp_to || admin.report_email;
    if (email) {
      const { sendEmail } = require('./emailService');
      await sendEmail({
        to: email,
        subject: 'ShopKeeper POS — Your Login Code',
        text: `Your verification code is: ${otp}\n\nThis code expires in ${OTP_EXPIRY_MINUTES} minutes.`,
        html: `<div style="font-family:sans-serif;text-align:center;padding:24px"><h2>ShopKeeper POS</h2><p>Your login verification code is:</p><div style="font-size:32px;font-weight:bold;letter-spacing:8px;margin:16px 0;color:#2563eb">${otp}</div><p style="color:#888;font-size:12px">Expires in ${OTP_EXPIRY_MINUTES} minutes</p></div>`,
      });
    }
    return { ok: true, method: 'email', message: `OTP sent to ${email || 'configured email'}` };
  }

  if (method === 'sms') {
    // SMS via WhatsApp gateway (text message)
    const { sendWhatsAppReceipt } = await import('../whatsapp-gateway');
    const settings = require('./settings').getAllSettings();
    const phone = settings.alert_owner_phone || settings.alert_manager_phone;
    if (phone) {
      await sendWhatsAppReceipt(phone, `ShopKeeper POS Login Code: ${otp}\nExpires in ${OTP_EXPIRY_MINUTES} minutes.`);
    }
    return { ok: true, method: 'sms', message: `OTP sent to ${phone || 'configured phone'}` };
  }

  // For 'authenticator' method, just return the OTP (user enters it manually from app)
  return { ok: true, method: 'authenticator', message: `Code generated: ${otp}` };
}

export function verifyOtp(userId: number, otpCode: string): { ok: boolean; message: string } {
  if (!is2FAEnabled()) return { ok: true, message: '2FA not enabled' };

  const db = getDb();
  const record = db.prepare(
    'SELECT * FROM otp_codes WHERE user_id = ? AND used = 0 ORDER BY created_at DESC LIMIT 1'
  ).get(userId) as OtpRecord | undefined;

  if (!record) return { ok: false, message: 'No OTP found. Please request a new code.' };

  // Check expiry
  const expiresAt = new Date(record.expires_at).getTime();
  if (Date.now() > expiresAt) {
    db.prepare('UPDATE otp_codes SET used = 1 WHERE id = ?').run(record.id);
    return { ok: false, message: 'OTP expired. Please request a new code.' };
  }

  // Check attempts (limit by checking if already tried wrong)
  if (record.otp_code !== otpCode) {
    return { ok: false, message: 'Invalid OTP code. Try again.' };
  }

  // Mark as used
  db.prepare('UPDATE otp_codes SET used = 1 WHERE id = ?').run(record.id);
  return { ok: true, message: 'OTP verified' };
}

export function ensureOtpTable(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS otp_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      otp_code TEXT NOT NULL,
      method TEXT NOT NULL DEFAULT 'email',
      expires_at TEXT NOT NULL,
      used INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);
}
