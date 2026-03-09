import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

// EN
import enCommon from './locales/en/common.json';
import enSettings from './locales/en/settings.json';
import enDashboard from './locales/en/dashboard.json';
import enChat from './locales/en/chat.json';
import enChannels from './locales/en/channels.json';
import enSkills from './locales/en/skills.json';
import enCron from './locales/en/cron.json';
import enSetup from './locales/en/setup.json';
import enEmployees from './locales/en/employees.json';
import enTasks from './locales/en/tasks.json';
import enMarketplace from './locales/en/marketplace.json';
import enCredits from './locales/en/credits.json';
import enBilling from './locales/en/billing.json';
import enBrowser from './locales/en/browser.json';
import enMediaStudio from './locales/en/media-studio.json';
import enProjects from './locales/en/projects.json';

// ZH
import zhCommon from './locales/zh/common.json';
import zhSettings from './locales/zh/settings.json';
import zhDashboard from './locales/zh/dashboard.json';
import zhChat from './locales/zh/chat.json';
import zhChannels from './locales/zh/channels.json';
import zhSkills from './locales/zh/skills.json';
import zhCron from './locales/zh/cron.json';
import zhSetup from './locales/zh/setup.json';
import zhEmployees from './locales/zh/employees.json';
import zhTasks from './locales/zh/tasks.json';
import zhMarketplace from './locales/zh/marketplace.json';
import zhCredits from './locales/zh/credits.json';
import zhBilling from './locales/zh/billing.json';
import zhBrowser from './locales/zh/browser.json';
import zhMediaStudio from './locales/zh/media-studio.json';
import zhProjects from './locales/zh/projects.json';

// JA
import jaCommon from './locales/ja/common.json';
import jaSettings from './locales/ja/settings.json';
import jaDashboard from './locales/ja/dashboard.json';
import jaChat from './locales/ja/chat.json';
import jaChannels from './locales/ja/channels.json';
import jaSkills from './locales/ja/skills.json';
import jaCron from './locales/ja/cron.json';
import jaSetup from './locales/ja/setup.json';
import jaEmployees from './locales/ja/employees.json';
import jaTasks from './locales/ja/tasks.json';
import jaMarketplace from './locales/ja/marketplace.json';
import jaCredits from './locales/ja/credits.json';
import jaBilling from './locales/ja/billing.json';
import jaBrowser from './locales/ja/browser.json';
import jaMediaStudio from './locales/ja/media-studio.json';
import jaProjects from './locales/ja/projects.json';

export const SUPPORTED_LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'zh', label: '中文' },
  { code: 'ja', label: '日本語' },
] as const;

export type LanguageCode = (typeof SUPPORTED_LANGUAGES)[number]['code'];

const resources = {
  en: {
    common: enCommon,
    settings: enSettings,
    dashboard: enDashboard,
    chat: enChat,
    channels: enChannels,
    skills: enSkills,
    cron: enCron,
    setup: enSetup,
    employees: enEmployees,
    tasks: enTasks,
    marketplace: enMarketplace,
    credits: enCredits,
    billing: enBilling,
    browser: enBrowser,
    'media-studio': enMediaStudio,
    projects: enProjects,
  },
  zh: {
    common: zhCommon,
    settings: zhSettings,
    dashboard: zhDashboard,
    chat: zhChat,
    channels: zhChannels,
    skills: zhSkills,
    cron: zhCron,
    setup: zhSetup,
    employees: zhEmployees,
    tasks: zhTasks,
    marketplace: zhMarketplace,
    credits: zhCredits,
    billing: zhBilling,
    browser: zhBrowser,
    'media-studio': zhMediaStudio,
    projects: zhProjects,
  },
  ja: {
    common: jaCommon,
    settings: jaSettings,
    dashboard: jaDashboard,
    chat: jaChat,
    channels: jaChannels,
    skills: jaSkills,
    cron: jaCron,
    setup: jaSetup,
    employees: jaEmployees,
    tasks: jaTasks,
    marketplace: jaMarketplace,
    credits: jaCredits,
    billing: jaBilling,
    browser: jaBrowser,
    'media-studio': jaMediaStudio,
    projects: jaProjects,
  },
};

i18n.use(initReactI18next).init({
  resources,
  lng: 'en', // will be overridden by settings store
  fallbackLng: 'en',
  defaultNS: 'common',
  ns: [
    'common',
    'settings',
    'dashboard',
    'chat',
    'channels',
    'skills',
    'cron',
    'setup',
    'employees',
    'tasks',
    'marketplace',
    'credits',
    'billing',
    'browser',
    'media-studio',
    'projects',
  ],
  interpolation: {
    escapeValue: false, // React already escapes
  },
  react: {
    useSuspense: false,
  },
});

export default i18n;
