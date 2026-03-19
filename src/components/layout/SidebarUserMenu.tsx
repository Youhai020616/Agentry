/**
 * SidebarUserMenu Component
 * User profile menu at the bottom of the sidebar.
 * Inspired by BetterChat's app-sidebar-user pattern.
 * Shows avatar + name + dropdown with theme, language, dev console, etc.
 */
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ChevronsUpDown,
  Sun,
  Moon,
  Monitor,
  Languages,
  Settings,
  Terminal,
  Globe,
  ExternalLink,
  Info,
  LogOut,
  Check,
  Palette,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSettingsStore } from '@/stores/settings';
import { SUPPORTED_LANGUAGES } from '@/i18n';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

// ── Types ──────────────────────────────────────────────────────

interface SidebarUserMenuProps {
  collapsed?: boolean;
}

// ── Theme config ───────────────────────────────────────────────

const THEME_OPTIONS = [
  { value: 'light', icon: Sun },
  { value: 'dark', icon: Moon },
  { value: 'illustration', icon: Palette },
  { value: 'system', icon: Monitor },
] as const;

// ── Component ──────────────────────────────────────────────────

export function SidebarUserMenu({ collapsed }: SidebarUserMenuProps) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const theme = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const language = useSettingsStore((s) => s.language);
  const setLanguage = useSettingsStore((s) => s.setLanguage);
  const devModeUnlocked = useSettingsStore((s) => s.devModeUnlocked);

  const currentLang = SUPPORTED_LANGUAGES.find((l) => l.code === language);

  const openDevConsole = async () => {
    try {
      const result = (await window.electron.ipcRenderer.invoke('gateway:getControlUiUrl')) as {
        success: boolean;
        url?: string;
        error?: string;
      };
      if (result.success && result.url) {
        window.electron.openExternal(result.url);
      }
    } catch (err) {
      console.error('Error opening Dev Console:', err);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={cn(
            'flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-sm',
            'transition-all duration-150 outline-none',
            'hover:bg-input hover:text-foreground',
            'data-[state=open]:bg-input data-[state=open]:text-foreground',
            'text-muted-foreground',
            collapsed && 'justify-center px-2'
          )}
        >
          {/* Avatar */}
          <div
            className={cn(
              'flex shrink-0 items-center justify-center rounded-full',
              'bg-gradient-to-br from-violet-400 to-indigo-500',
              'text-white font-semibold text-xs',
              'h-7 w-7'
            )}
          >
            U
          </div>

          {!collapsed && (
            <>
              <div className="flex-1 min-w-0 text-left">
                <div className="truncate text-sm font-medium text-foreground/90">
                  {t('userMenu.defaultName', 'User')}
                </div>
                <div className="truncate text-[11px] text-muted-foreground">
                  {t('userMenu.localAccount', 'Local Account')}
                </div>
              </div>
              <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
            </>
          )}
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        side={collapsed ? 'right' : 'top'}
        align={collapsed ? 'end' : 'center'}
        className="w-56 rounded-xl"
        sideOffset={8}
      >
        {/* User info card */}
        <DropdownMenuLabel className="p-0 font-normal">
          <div className="flex items-center gap-2.5 px-2 py-2">
            <div
              className={cn(
                'flex shrink-0 items-center justify-center rounded-full',
                'bg-gradient-to-br from-violet-400 to-indigo-500',
                'text-white font-semibold text-xs',
                'h-8 w-8'
              )}
            >
              U
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                {t('userMenu.defaultName', 'User')}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {t('userMenu.localAccount', 'Local Account')}
              </p>
            </div>
          </div>
        </DropdownMenuLabel>

        <DropdownMenuSeparator />

        {/* Theme */}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="rounded-lg cursor-pointer">
            <Palette className="h-4 w-4" />
            <span>{t('userMenu.theme', 'Theme')}</span>
            <span className="ml-auto text-xs text-muted-foreground">
              {t(`userMenu.theme_${theme}`, theme)}
            </span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="rounded-xl">
            {THEME_OPTIONS.map(({ value, icon: Icon }) => (
              <DropdownMenuItem
                key={value}
                className="rounded-lg cursor-pointer"
                onClick={() => setTheme(value)}
              >
                <Icon className="h-4 w-4" />
                <span>{t(`userMenu.theme_${value}`, value)}</span>
                {theme === value && <Check className="ml-auto h-4 w-4 text-primary" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        {/* Language */}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="rounded-lg cursor-pointer">
            <Languages className="h-4 w-4" />
            <span>{t('userMenu.language', 'Language')}</span>
            <span className="ml-auto text-xs text-muted-foreground">{currentLang?.label}</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="rounded-xl">
            {SUPPORTED_LANGUAGES.map((lang) => (
              <DropdownMenuItem
                key={lang.code}
                className="rounded-lg cursor-pointer"
                onClick={() => setLanguage(lang.code)}
              >
                <span>{lang.label}</span>
                {language === lang.code && <Check className="ml-auto h-4 w-4 text-primary" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSeparator />

        {/* Settings */}
        <DropdownMenuItem
          className="rounded-lg cursor-pointer"
          onClick={() => navigate('/settings')}
        >
          <Settings className="h-4 w-4" />
          <span>{t('nav.settings')}</span>
        </DropdownMenuItem>

        {/* Browser Control (dev tool) */}
        {devModeUnlocked && (
          <DropdownMenuItem
            className="rounded-lg cursor-pointer"
            onClick={() => navigate('/browser')}
          >
            <Globe className="h-4 w-4" />
            <span>{t('nav.browser')}</span>
          </DropdownMenuItem>
        )}

        {/* Dev Console */}
        {devModeUnlocked && (
          <DropdownMenuItem className="rounded-lg cursor-pointer" onClick={openDevConsole}>
            <Terminal className="h-4 w-4" />
            <span>{t('sidebar.devConsole')}</span>
            <ExternalLink className="ml-auto h-3 w-3 text-muted-foreground/50" />
          </DropdownMenuItem>
        )}

        {/* About */}
        <DropdownMenuItem
          className="rounded-lg cursor-pointer"
          onClick={() => {
            window.electron.ipcRenderer.invoke('app:getVersion').then((v) => {
              console.log('Agentry version:', v);
            });
          }}
        >
          <Info className="h-4 w-4" />
          <span>{t('userMenu.about', 'About Agentry')}</span>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        {/* Sign out (placeholder for future auth) */}
        <DropdownMenuItem className="rounded-lg cursor-pointer text-destructive focus:text-destructive">
          <LogOut className="h-4 w-4" />
          <span>{t('userMenu.signOut', 'Sign Out')}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
