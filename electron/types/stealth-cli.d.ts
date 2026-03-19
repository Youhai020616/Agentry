declare module 'stealth-cli' {
  export function launchBrowser(opts?: Record<string, unknown>): Promise<StealthHandle>;
  export function closeBrowser(handle: StealthHandle): Promise<void>;
  export function navigate(
    handle: StealthHandle,
    url: string,
    opts?: Record<string, unknown>
  ): Promise<string>;
  export function getSnapshot(handle: StealthHandle): Promise<string>;
  export function getTextContent(handle: StealthHandle): Promise<string>;
  export function getTitle(handle: StealthHandle): Promise<string>;
  export function getUrl(handle: StealthHandle): Promise<string>;
  export function takeScreenshot(
    handle: StealthHandle,
    opts?: Record<string, unknown>
  ): Promise<{ data: string }>;
  export function evaluate(handle: StealthHandle, expression: string): Promise<unknown>;
  export function waitForReady(page: unknown, opts?: Record<string, unknown>): Promise<void>;
  export function listProfiles(): Array<{ name: string }>;

  interface StealthHandle {
    browser: unknown;
    context: unknown;
    page: unknown;
    isDaemon: boolean;
    _meta: {
      profileName?: string;
      sessionName?: string;
      proxyUrl?: string;
      sessionInfo?: unknown;
    };
  }
}
