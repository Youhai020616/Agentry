/**
 * Media Studio Page
 * Main page component that renders an internal sidebar + view switching area.
 * Uses negative margin to escape MainLayout padding for full-bleed layout.
 */
import { useTranslation } from 'react-i18next';
import { useMediaStudioStore } from '@/stores/media-studio';
import type { MediaStudioView } from '@/types/media-studio';
import { MediaSidebar } from './MediaSidebar';
import { DashboardView } from './views/DashboardView';
import { ContentLibraryView } from './views/ContentLibraryView';
import { StudioView } from './views/StudioView';
import { WorkflowView } from './views/WorkflowView';
import { CrmView } from './views/CrmView';
import { ReportsView } from './views/ReportsView';
import { CostView } from './views/CostView';

/** Placeholder component for views not yet built */
function ViewPlaceholder({ viewName }: { viewName: string }) {
  const { t } = useTranslation('media-studio');

  return (
    <div className="flex h-full items-center justify-center">
      <div className="text-center">
        <div className="text-4xl mb-4">{getViewEmoji(viewName)}</div>
        <h2 className="text-lg font-semibold text-foreground">{t(`nav.${viewName}`)}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('page.title')} &mdash; {viewName}
        </p>
      </div>
    </div>
  );
}

function getViewEmoji(viewName: string): string {
  const emojiMap: Record<string, string> = {
    dashboard: '\uD83D\uDCCA',
    studio: '\uD83C\uDFA8',
    content: '\uD83D\uDCDD',
    workflow: '\uD83D\uDD04',
    crm: '\uD83D\uDC65',
    reports: '\uD83D\uDCCB',
    cost: '\uD83D\uDCB0',
  };
  return emojiMap[viewName] || '\uD83D\uDCE6';
}

/** Renders the correct view based on activeView from the store */
function ViewSwitch({ activeView }: { activeView: MediaStudioView }) {
  if (activeView === 'dashboard') {
    return <DashboardView />;
  }

  if (activeView === 'content') {
    return <ContentLibraryView />;
  }

  if (activeView === 'studio') {
    return <StudioView />;
  }

  if (activeView === 'workflow') {
    return <WorkflowView />;
  }

  if (activeView === 'crm') {
    return <CrmView />;
  }

  if (activeView === 'reports') {
    return <ReportsView />;
  }

  if (activeView === 'cost') {
    return <CostView />;
  }

  // Remaining views render placeholders until built
  return <ViewPlaceholder viewName={activeView} />;
}

export function MediaStudio() {
  const activeView = useMediaStudioStore((s) => s.activeView);

  return (
    <div className="-m-6 flex h-[calc(100%+48px)]">
      {/* Internal sidebar */}
      <MediaSidebar />

      {/* Content area */}
      <div className="flex-1 overflow-auto p-6">
        <ViewSwitch activeView={activeView} />
      </div>
    </div>
  );
}
