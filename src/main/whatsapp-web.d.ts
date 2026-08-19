declare module 'whatsapp-web.js' {
  export class LocalAuth {
    constructor(options?: { clientId?: string; dataPath?: string });
  }

  export class Client {
    constructor(options?: { authStrategy?: unknown; puppeteer?: Record<string, unknown> });
    info?: { wid?: { user?: string }; me?: { user?: string } };
    initialize(): Promise<void>;
    on(event: string, listener: (...args: any[]) => void): this;
    sendMessage(chatId: string, message: string): Promise<unknown>;
  }
}