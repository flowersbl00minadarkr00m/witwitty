/** Minimal local platform types keep shared packages independent of the Chrome SDK. */
export interface Port {
  postMessage(value: unknown): void;
  disconnect(): void;
  onMessage: {
    addListener(callback: (value: unknown) => void): void;
  };
  onDisconnect: {
    addListener(callback: () => void): void;
  };
}
interface ChromeApi {
  runtime: {
    id: string;
    getURL(path: string): string;
    connect(options: {
      name: string;
    }): Port;
    sendMessage(value: unknown): Promise<unknown>;
    onMessage: {
      addListener(callback: (value: unknown) => void): void;
      removeListener(callback: (value: unknown) => void): void;
    };
  };
}
export function chromeApi(): ChromeApi {
  const chrome = (globalThis as unknown as {
    chrome?: ChromeApi;
  }).chrome;
  if (!chrome?.runtime?.id)
    throw new Error('Chrome extension context required');
  return chrome;
}
