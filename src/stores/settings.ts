/**
 * Settings State Store
 * Manages application settings
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import i18n from '@/i18n';

type Theme = 'light' | 'dark' | 'system' | 'illustration';
type UpdateChannel = 'stable' | 'beta' | 'dev';

/** Media Studio API configuration for image/video generation pipeline */
export interface MediaStudioConfig {
  /** DeerAPI / Gemini API key for image generation */
  imageApiKey: string;
  /** Image generation model ID (e.g. gemini-3-pro-image) */
  imageModel: string;
  /** API key for video generation */
  videoApiKey: string;
  /** Video generation model ID (e.g. veo-2.0-generate-001) */
  videoModel: string;
  /** Video API endpoint URL */
  videoApiUrl: string;
}

const defaultMediaStudioConfig: MediaStudioConfig = {
  imageApiKey: '',
  imageModel: 'gemini-3-pro-image',
  videoApiKey: '',
  videoModel: 'veo-2.0-generate-001',
  videoApiUrl: 'https://api.deerapi.com/v1/chat/completions',
};

interface SettingsState {
  // General
  theme: Theme;
  language: string;
  startMinimized: boolean;
  launchAtStartup: boolean;

  // Gateway
  gatewayAutoStart: boolean;
  gatewayPort: number;

  // Update
  updateChannel: UpdateChannel;
  autoCheckUpdate: boolean;
  autoDownloadUpdate: boolean;

  // UI State
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  devModeUnlocked: boolean;

  // Setup
  setupComplete: boolean;

  // BYOK
  byokEnabled: boolean;

  // Media Studio
  mediaStudio: MediaStudioConfig;

  // Actions
  setTheme: (theme: Theme) => void;
  setLanguage: (language: string) => void;
  setStartMinimized: (value: boolean) => void;
  setLaunchAtStartup: (value: boolean) => void;
  setGatewayAutoStart: (value: boolean) => void;
  setGatewayPort: (port: number) => void;
  setUpdateChannel: (channel: UpdateChannel) => void;
  setAutoCheckUpdate: (value: boolean) => void;
  setAutoDownloadUpdate: (value: boolean) => void;
  setSidebarCollapsed: (value: boolean) => void;
  setSidebarWidth: (value: number) => void;
  setDevModeUnlocked: (value: boolean) => void;
  setByokEnabled: (value: boolean) => void;
  setMediaStudio: (config: Partial<MediaStudioConfig>) => void;
  resetMediaStudio: () => void;
  markSetupComplete: () => void;
  resetSettings: () => void;
}

const defaultSettings = {
  theme: 'system' as Theme,
  language: (() => {
    const lang = navigator.language.toLowerCase();
    if (lang.startsWith('zh')) return 'zh';
    if (lang.startsWith('ja')) return 'ja';
    return 'en';
  })(),
  startMinimized: false,
  launchAtStartup: false,
  gatewayAutoStart: true,
  gatewayPort: 18790,
  updateChannel: 'stable' as UpdateChannel,
  autoCheckUpdate: true,
  autoDownloadUpdate: false,
  sidebarCollapsed: false,
  sidebarWidth: 176,
  devModeUnlocked: false,
  setupComplete: false,
  byokEnabled: false,
  mediaStudio: { ...defaultMediaStudioConfig },
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      ...defaultSettings,

      setTheme: (theme) => set({ theme }),
      setLanguage: (language) => {
        i18n.changeLanguage(language);
        set({ language });
      },
      setStartMinimized: (startMinimized) => set({ startMinimized }),
      setLaunchAtStartup: (launchAtStartup) => set({ launchAtStartup }),
      setGatewayAutoStart: (gatewayAutoStart) => set({ gatewayAutoStart }),
      setGatewayPort: (gatewayPort) => set({ gatewayPort }),
      setUpdateChannel: (updateChannel) => set({ updateChannel }),
      setAutoCheckUpdate: (autoCheckUpdate) => set({ autoCheckUpdate }),
      setAutoDownloadUpdate: (autoDownloadUpdate) => set({ autoDownloadUpdate }),
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
      setSidebarWidth: (sidebarWidth) => set({ sidebarWidth }),
      setDevModeUnlocked: (devModeUnlocked) => set({ devModeUnlocked }),
      setByokEnabled: (byokEnabled) => set({ byokEnabled }),
      setMediaStudio: (config) =>
        set((state) => ({
          mediaStudio: { ...state.mediaStudio, ...config },
        })),
      resetMediaStudio: () => set({ mediaStudio: { ...defaultMediaStudioConfig } }),
      markSetupComplete: () => set({ setupComplete: true }),
      resetSettings: () => set(defaultSettings),
    }),
    {
      name: 'agentry-settings',
    }
  )
);
