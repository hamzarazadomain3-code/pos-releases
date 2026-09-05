import { getAllAdminSettings } from './admin';
import { getAllSettings } from './settings';
import { getSale } from './sales';
import { buildReceiptText, buildReceiptHtml } from './printing';

interface SmsResult {
  ok: boolean;
  message: string;
}

export async function sendSmsReceipt(saleId: number, phoneNumber: string): Promise<SmsResult> {
  const admin = getAllAdminSettings();
  const smsProvider = admin.sms_provider;
  const smsApiKey = admin.sms_api_key;
  const smsSender = admin.sms_sender || 'ShopKeeperPOS';

  if (!smsProvider || !smsApiKey) {
    return { ok: false, message: 'SMS not configured - set SMS settings in Admin > Settings' };
  }

  if (!phoneNumber) {
    return { ok: false, message: 'No phone number provided' };
  }

  const text = buildReceiptText(saleId);
  const settings = getAllSettings();
  const message = `${settings.shop_name || 'ShopKeeper POS'}\n\n${text}`;

  try {
    if (smsProvider === 'twilio') {
      return await sendTwilioSms(phoneNumber, message, admin);
    } else if (smsProvider === 'textlocal') {
      return await sendTextLocalSms(phoneNumber, message, admin);
    } else if (smsProvider === 'api') {
      return await sendApiSms(phoneNumber, message, admin);
    }
    return { ok: false, message: 'Unknown SMS provider' };
  } catch (err) {
    return { ok: false, message: `SMS failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

async function sendTwilioSms(to: string, body: string, admin: Record<string, string>): Promise<SmsResult> {
  const accountSid = admin.sms_api_key;
  const authToken = admin.sms_api_secret;
  const from = admin.sms_sender;

  if (!accountSid || !authToken || !from) {
    return { ok: false, message: 'Twilio credentials incomplete' };
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
  const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');

  const params = new URLSearchParams();
  params.append('To', to);
  params.append('From', from);
  params.append('Body', body);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  if (response.ok) {
    return { ok: true, message: `SMS sent to ${to}` };
  }
  const err = await response.text();
  return { ok: false, message: `Twilio error: ${err}` };
}

async function sendTextLocalSms(to: string, body: string, admin: Record<string, string>): Promise<SmsResult> {
  const apiKey = admin.sms_api_key;
  const sender = admin.sms_sender || 'ShopKeeperPOS';

  const params = new URLSearchParams();
  params.append('apiKey', apiKey);
  params.append('message', body);
  params.append('numbers', to);
  params.append('sender', sender);

  const response = await fetch('https://api.textlocal.in/send/', {
    method: 'POST',
    body: params,
  });

  if (response.ok) {
    return { ok: true, message: `SMS sent to ${to}` };
  }
  const err = await response.text();
  return { ok: false, message: `TextLocal error: ${err}` };
}

async function sendApiSms(to: string, body: string, admin: Record<string, string>): Promise<SmsResult> {
  const apiUrl = admin.sms_api_url;
  const apiKey = admin.sms_api_key;

  if (!apiUrl) {
    return { ok: false, message: 'SMS API URL not configured' };
  }

  const url = apiUrl.replace('{phone}', to).replace('{message}', encodeURIComponent(body)).replace('{key}', apiKey);

  const response = await fetch(url);
  if (response.ok) {
    return { ok: true, message: `SMS sent to ${to}` };
  }
  return { ok: false, message: 'SMS API request failed' };
}

export async function sendEmailReceipt(saleId: number, email: string): Promise<{ ok: boolean; message: string }> {
  const { sendEmail } = require('./emailService');
  const sale = getSale(saleId);
  if (!sale) return { ok: false, message: 'Sale not found' };

  const settings = getAllSettings();
  const html = buildReceiptHtml(saleId);
  const text = buildReceiptText(saleId);

  return sendEmail({
    to: email,
    subject: `Receipt from ${settings.shop_name || 'ShopKeeper POS'} - ${sale.invoice_no}`,
    text,
    html,
  });
}
