/**
 * Main Layout Component
 * TitleBar at top, then sidebar + content below.
 */
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { TitleBar } from './TitleBar';

export function MainLayout() {
  return (
    <div className="flex h-screen flex-col overflow-hidden">
      {/* Title bar: drag region on macOS, icon + controls on Windows */}
      <TitleBar />

      {/* Below the title bar: sidebar + content */}
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-hidden my-1.5 mr-1.5">
          <div className="h-full overflow-auto rounded-2xl bg-card/60 backdrop-blur-xl glass-border shadow-island px-4 py-3">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
