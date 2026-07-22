type ChromeMessageSender = { url?: string; tab?: { id?: number; url?: string } };
type ChromeTab = { id?: number; url?: string; status?: string };

declare const chrome: {
  runtime: {
    getManifest(): { version: string };
    getURL(path: string): string;
    openOptionsPage(): Promise<void>;
    sendMessage<T = unknown>(message: unknown): Promise<T>;
    onMessage: {
      addListener(
        callback: (
          message: unknown,
          sender: ChromeMessageSender,
          sendResponse: (response: unknown) => void,
        ) => boolean | void,
      ): void;
    };
    onStartup: { addListener(callback: () => void): void };
    onInstalled: { addListener(callback: () => void): void };
  };
  storage: {
    local: {
      get(keys: string | string[]): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
      remove(keys: string | string[]): Promise<void>;
    };
  };
  tabs: {
    query(queryInfo: { url?: string[] }): Promise<ChromeTab[]>;
    create(createProperties: { url: string; active?: boolean }): Promise<ChromeTab>;
    get(tabId: number): Promise<ChromeTab>;
    update(tabId: number, updateProperties: { active?: boolean }): Promise<ChromeTab>;
    sendMessage<T = unknown>(tabId: number, message: unknown): Promise<T>;
    onUpdated: {
      addListener(callback: (tabId: number, changeInfo: { status?: string }, tab: ChromeTab) => void): void;
      removeListener(callback: (tabId: number, changeInfo: { status?: string }, tab: ChromeTab) => void): void;
    };
  };
  scripting: {
    executeScript(input: {
      target: { tabId: number; allFrames?: boolean };
      files: string[];
    }): Promise<unknown>;
  };
  permissions: {
    contains(input: { origins: string[] }): Promise<boolean>;
    request(input: { origins: string[] }): Promise<boolean>;
  };
};

declare const __PROJECTAI_ALLOWED_ORIGINS__: readonly string[];
declare const __WECOM_ALLOWED_ORIGIN__: string;
declare const __EXTENSION_VERSION__: string;
declare const __WECOM_ADAPTER_TIMEOUT_MS__: number;
declare const __MANUAL_ACTUAL_SYNC_ALLOWED__: boolean;

interface Window {
  __PROJECTAI_WECOM_TEST__?: {
    execute(input: unknown): Promise<unknown>;
  };
}
