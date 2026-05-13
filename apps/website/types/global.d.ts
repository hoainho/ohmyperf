declare global {
  interface Window {
    chrome?: {
      runtime?: {
        sendMessage(
          extensionId: string,
          message: unknown,
          callback?: (response: unknown) => void,
        ): void;
        lastError?: { message: string };
        connect(extensionId: string, info?: { name?: string }): chrome.runtime.Port;
      };
    };
  }
}

declare namespace chrome.runtime {
  interface Port {
    name: string;
    postMessage(msg: unknown): void;
    disconnect(): void;
    onMessage: { addListener(cb: (msg: unknown) => void): void; removeListener(cb: (msg: unknown) => void): void };
    onDisconnect: { addListener(cb: () => void): void };
  }
}

export {};
