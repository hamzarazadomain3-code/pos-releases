// whatsapp-web.js shim — `whatsapp-gateway.ts` launches a headless WhatsApp Web
// session. That cannot run in a Worker, so the classes exist (so the dynamic
// `import('whatsapp-web.js')` resolves) and every method is inert.
export class Client {
  constructor(_options?: unknown) {}
  on(): void {}
  initialize(): Promise<void> {
    return Promise.resolve();
  }
  destroy(): Promise<void> {
    return Promise.resolve();
  }
  sendMessage(): Promise<void> {
    return Promise.resolve();
  }
  getState(): Promise<string> {
    return Promise.resolve('DISCONNECTED');
  }
}

export class LocalAuth {
  constructor(_options?: unknown) {}
}

export default { Client, LocalAuth };
