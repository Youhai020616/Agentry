/**
 * Chat Toolbar
 * Session selector, new session, refresh, and thinking toggle.
 * Rendered in the Header when on the Chat page.
 */
import { RefreshCw, Brain, ChevronDown, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useChatStore } from '@/stores/chat';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';

interface ChatToolbarProps {
  /** Hide session selector dropdown (used in employee chat mode) */
  hideSessionSelector?: boolean;
  /** @deprecated Use hideSessionSelector instead */
  hideSessionControls?: boolean;
}

export function ChatToolbar({ hideSessionSelector, hideSessionControls }: ChatToolbarProps = {}) {
  const hideSelector = hideSessionSelector ?? hideSessionControls ?? false;
  const sessions = useChatStore((s) => s.sessions);
  const currentSessionKey = useChatStore((s) => s.currentSessionKey);
  const switchSession = useChatStore((s) => s.switchSession);
  const newSession = useChatStore((s) => s.newSession);
  const refresh = useChatStore((s) => s.refresh);
  const loading = useChatStore((s) => s.loading);
  const showThinking = useChatStore((s) => s.showThinking);
  const toggleThinking = useChatStore((s) => s.toggleThinking);
  const { t } = useTranslation('chat');

  const handleSessionChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    switchSession(e.target.value);
  };

  return (
    <div className="flex items-center gap-2">
      {/* Session Selector — hidden in employee chat mode */}
      {!hideSelector && (
        <div className="relative">
          <select
            value={currentSessionKey}
            onChange={handleSessionChange}
            className={cn(
              'appearance-none rounded-md border border-border bg-background px-3 py-1.5 pr-8',
              'text-sm text-foreground cursor-pointer',
              'focus:outline-none focus:ring-2 focus:ring-ring'
            )}
          >
            {!sessions.some((s) => s.key === currentSessionKey) && (
              <option value={currentSessionKey}>{currentSessionKey}</option>
            )}
            {sessions.map((s) => (
              <option key={s.key} value={s.key}>
                {s.key}
              </option>
            ))}
          </select>
          <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
        </div>
      )}

      {/* New Session — always visible so users can reset context */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={newSession}>
            <Plus className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>{t('toolbar.newSession')}</p>
        </TooltipContent>
      </Tooltip>

      {/* Refresh */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => refresh()}
            disabled={loading}
          >
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>{t('toolbar.refresh')}</p>
        </TooltipContent>
      </Tooltip>

      {/* Thinking Toggle */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={cn('h-8 w-8', showThinking && 'bg-primary/10 text-primary')}
            onClick={toggleThinking}
          >
            <Brain className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>{showThinking ? t('toolbar.hideThinking') : t('toolbar.showThinking')}</p>
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
