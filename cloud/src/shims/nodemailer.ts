// nodemailer shim — `emailService.ts` sends SMTP mail through a Node transport.
// The web app cannot open SMTP sockets, so sends are recorded as failures and the
// UI surfaces them; the module still bundles.
const transport = {
  sendMail: async (): Promise<{ messageId: string; accepted: string[] }> => ({
    messageId: 'web-stub',
    accepted: [],
  }),
  verify: async (): Promise<boolean> => false,
};

export function createTransport(): typeof transport {
  return transport;
}
export default { createTransport };
