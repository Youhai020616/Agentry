/**
 * Supervisor Manager Page
 * Split layout: Left 2/3 chat + Right 1/3 orchestration panel.
 * Default: Supervisor selected → chat with the PM agent.
 * Click employee in dock → switch to that employee's direct chat.
 * Right panel shows active projects, wave progress, and team status.
 *
 * Phase 1: Supervisor is now an independent agent with session key `agent:supervisor:main`.
 * No longer uses `agent:main:main` — the supervisor employee is auto-activated on mount.
 */
import { useEffect, useMemo, useCallback, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Crown, AlertCircle, PanelRightClose, PanelRightOpen, GripVertical } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';
import { Chat } from '@/pages/Chat';
import { ChatToolbar } from '@/pages/Chat/ChatToolbar';
import { useEmployeesStore } from '@/stores/employees';
import { useChatStore } from '@/stores/chat';
import { useGatewayStore } from '@/stores/gateway';
import { MessageDock, type DockCharacter } from '@/components/ui/message-dock';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { Button } from '@/components/ui/button';
import { useSettingsStore } from '@/stores/settings';
import { OrchestrationPanel } from './OrchestrationPanel';
import { LightRays } from '@/components/chat/LightRays';

// ── Right Panel Resize Constants ────────────────────────────────
const PANEL_MIN_WIDTH = 240;
const PANEL_MAX_WIDTH = 480;
const PANEL_DEFAULT_WIDTH = 320;
const PANEL_COLLAPSE_THRESHOLD = 180;

// ── Right Panel Resize Handle ───────────────────────────────────
function PanelResizeHandle({
  isDragging,
  onMouseDown,
  onDoubleClick,
}: {
  isDragging: boolean;
  onMouseDown: (e: React.MouseEvent) => void;
  onDoubleClick: () => void;
}) {
  return (
    <div
      className={cn(
        'absolute left-0 top-2 bottom-2 z-10 flex w-[6px] cursor-col-resize items-center justify-center',
        'transition-colors duration-150 rounded-full',
        'group/handle',
        isDragging ? 'bg-primary/20' : 'hover:bg-primary/10'
      )}
      onMouseDown={onMouseDown}
      onDoubleClick={onDoubleClick}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize panel"
    >
      <div
        className={cn(
          'flex h-8 w-[4px] items-center justify-center rounded-full transition-opacity duration-150',
          isDragging
            ? 'opacity-100 bg-primary/30'
            : 'opacity-0 group-hover/handle:opacity-100 bg-muted-foreground/20'
        )}
      >
        <GripVertical className="h-3 w-3 text-muted-foreground/60" />
      </div>
    </div>
  );
}

/** Default supervisor slug — matches resources/employees/supervisor/ */
const SUPERVISOR_SLUG = 'supervisor';

/** Internal UI identifier for the supervisor dock item (not a session key) */
const SUPERVISOR_ID = '__supervisor__';

/** Fallback session key when supervisor employee data is not yet loaded */
const SUPERVISOR_SESSION_FALLBACK = `agent:${SUPERVISOR_SLUG}:main`;

export function Supervisor() {
  const { t } = useTranslation('common');

  const gatewayStatus = useGatewayStore((s) => s.status);
  const isGatewayRunning = gatewayStatus.state === 'running';

  const employees = useEmployeesStore((s) => s.employees);
  const fetchEmployees = useEmployeesStore((s) => s.fetchEmployees);
  const activateEmployee = useEmployeesStore((s) => s.activateEmployee);
  const deactivateEmployee = useEmployeesStore((s) => s.deactivateEmployee);
  const init = useEmployeesStore((s) => s.init);

  const switchSession = useChatStore((s) => s.switchSession);

  const [selectedId, setSelectedId] = useState<string>(SUPERVISOR_ID);
  const [activating, setActivating] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);

  // ── Right panel resize ──
  const panelWidth = useSettingsStore((s) => s.orchestrationPanelWidth);
  const setPanelWidth = useSettingsStore((s) => s.setOrchestrationPanelWidth);
  const [isDraggingPanel, setIsDraggingPanel] = useState(false);
  const panelStartXRef = useRef(0);
  const panelStartWidthRef = useRef(0);

  const handlePanelMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      panelStartXRef.current = e.clientX;
      panelStartWidthRef.current = panelWidth;
      setIsDraggingPanel(true);
    },
    [panelWidth]
  );

  useEffect(() => {
    if (!isDraggingPanel) return;

    const handleMouseMove = (e: MouseEvent) => {
      e.preventDefault();
      // Right panel: dragging left = wider, dragging right = narrower
      const delta = panelStartXRef.current - e.clientX;
      const newWidth = panelStartWidthRef.current + delta;

      if (newWidth < PANEL_COLLAPSE_THRESHOLD) {
        setIsDraggingPanel(false);
        setPanelOpen(false);
        return;
      }

      const clamped = Math.max(PANEL_MIN_WIDTH, Math.min(PANEL_MAX_WIDTH, newWidth));
      setPanelWidth(clamped);
    };

    const handleMouseUp = () => {
      setIsDraggingPanel(false);
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDraggingPanel, setPanelWidth]);

  const handlePanelDoubleClick = useCallback(() => {
    setPanelWidth(PANEL_DEFAULT_WIDTH);
  }, [setPanelWidth]);

  // Guard to prevent double-activation of supervisor
  const supervisorActivating = useRef(false);

  // Derive supervisor session key dynamically from the employees store
  const supervisorEmployee = useMemo(
    () => employees.find((e) => e.id === SUPERVISOR_SLUG || e.slug === SUPERVISOR_SLUG),
    [employees]
  );
  const supervisorSessionKey = supervisorEmployee?.gatewaySessionKey ?? SUPERVISOR_SESSION_FALLBACK;

  // Initialize employees store
  useEffect(() => {
    init();
    fetchEmployees();
  }, [init, fetchEmployees]);

  /**
   * After supervisor is ready, find the most recent supervisor conversation
   * and switch to it. Falls back to the default session key if none exist.
   *
   * Queries electron-store directly via IPC to avoid store timing issues.
   */
  const restoreOrCreateSession = useCallback(
    async (fallbackKey: string) => {
      try {
        // Read all conversations directly from electron-store via IPC
        const result = (await window.electron.ipcRenderer.invoke('conversation:listAll')) as {
          success: boolean;
          result?: Array<{
            sessionKey: string;
            participantType: string;
            archived: boolean;
            updatedAt: number;
            messageCount: number;
            lastMessagePreview?: string;
          }>;
        };

        if (result.success && Array.isArray(result.result)) {
          // Filter to supervisor conversations, sort by updatedAt desc
          const supervisorConvs = result.result
            .filter((c) => c.participantType === 'supervisor' && !c.archived)
            .sort((a, b) => b.updatedAt - a.updatedAt);

          if (supervisorConvs.length > 0) {
            // Always pick the most recent conversation by time
            switchSession(supervisorConvs[0].sessionKey);
            return;
          }
        }
      } catch {
        // Non-fatal — fall through to default
      }
      switchSession(fallbackKey);
    },
    [switchSession]
  );

  // Auto-activate supervisor when gateway is ready
  useEffect(() => {
    if (!isGatewayRunning) return;
    if (supervisorActivating.current) return;

    const sup = employees.find((e) => e.id === SUPERVISOR_SLUG || e.slug === SUPERVISOR_SLUG);

    // If supervisor is not found or offline, activate it
    if (!sup || sup.status === 'offline') {
      supervisorActivating.current = true;
      activateEmployee(SUPERVISOR_SLUG)
        .then(() => {
          const updated = useEmployeesStore
            .getState()
            .employees.find((e) => e.id === SUPERVISOR_SLUG || e.slug === SUPERVISOR_SLUG);
          const key = updated?.gatewaySessionKey ?? SUPERVISOR_SESSION_FALLBACK;
          if (selectedId === SUPERVISOR_ID) {
            restoreOrCreateSession(key);
          }
        })
        .catch((err) => {
          console.error('Failed to auto-activate supervisor:', err);
        })
        .finally(() => {
          supervisorActivating.current = false;
        });
    } else if (selectedId === SUPERVISOR_ID) {
      // Supervisor is already active — restore most recent conversation
      restoreOrCreateSession(sup.gatewaySessionKey ?? SUPERVISOR_SESSION_FALLBACK);
    }
  }, [isGatewayRunning]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-open orchestration panel when a project is created (sessions_spawn detected)
  useEffect(() => {
    const handler = (...args: unknown[]) => {
      const p = args[0] as { id?: string; status?: string };
      if (p?.id && !panelOpen) {
        setPanelOpen(true);
      }
    };
    window.electron.ipcRenderer.on('project:changed', handler);
    return () => {
      window.electron.ipcRenderer.off('project:changed', handler);
    };
  }, [panelOpen]);

  // Build dock characters: Supervisor first, then employees
  const dockCharacters: DockCharacter[] = useMemo(() => {
    // Derive supervisor dock status from the actual employee record
    const supStatus = supervisorEmployee
      ? supervisorEmployee.status === 'offline'
        ? 'offline'
        : supervisorEmployee.status
      : 'idle';

    const supervisor: DockCharacter = {
      id: SUPERVISOR_ID,
      name: supervisorEmployee?.name || t('supervisor.title'),
      avatar: supervisorEmployee?.avatar || '\uD83D\uDC54',
      avatarImagePath: supervisorEmployee?.avatarImagePath,
      status: supStatus,
    };

    const employeeChars: DockCharacter[] = employees
      .filter((e) => e.id !== SUPERVISOR_SLUG && e.slug !== SUPERVISOR_SLUG)
      .map((e) => ({
        id: e.id,
        name: e.name,
        avatar: e.avatar || '\uD83E\uDD16',
        avatarImagePath: e.avatarImagePath,
        status: e.status === 'offline' ? 'offline' : e.status,
      }));

    return [supervisor, ...employeeChars];
  }, [employees, supervisorEmployee, t]);

  // Current employee info for Chat props
  const selectedEmployee = useMemo(() => {
    if (selectedId === SUPERVISOR_ID) return null;
    return employees.find((e) => e.id === selectedId) ?? null;
  }, [selectedId, employees]);

  // Handle character selection
  const handleSelect = useCallback(
    async (id: string) => {
      if (id === selectedId) return;
      setSelectedId(id);

      if (id === SUPERVISOR_ID) {
        // Restore most recent supervisor conversation or fall back to default key
        restoreOrCreateSession(supervisorSessionKey);
        return;
      }

      // Find the employee
      const employee = employees.find((e) => e.id === id);
      if (!employee) return;

      // If offline, activate first
      if (employee.status === 'offline') {
        setActivating(true);
        try {
          await activateEmployee(employee.id);
          const updated = useEmployeesStore.getState().employees.find((e) => e.id === id);
          if (updated?.gatewaySessionKey) {
            switchSession(updated.gatewaySessionKey);
          }
        } catch (err) {
          console.error('Failed to activate employee:', err);
        } finally {
          setActivating(false);
        }
        return;
      }

      // Already active — switch session
      if (employee.gatewaySessionKey) {
        switchSession(employee.gatewaySessionKey);
      }
    },
    [
      selectedId,
      employees,
      switchSession,
      activateEmployee,
      supervisorSessionKey,
      restoreOrCreateSession,
    ]
  );

  // Handle deactivation from dock context menu (excludes supervisor)
  const handleDeactivate = useCallback(
    async (id: string) => {
      if (id === SUPERVISOR_ID) return;
      try {
        await deactivateEmployee(id);
        // If the deactivated employee was selected, switch back to supervisor
        if (selectedId === id) {
          setSelectedId(SUPERVISOR_ID);
          restoreOrCreateSession(supervisorSessionKey);
        }
      } catch (err) {
        console.error('Failed to deactivate employee:', err);
      }
    },
    [deactivateEmployee, selectedId, restoreOrCreateSession, supervisorSessionKey]
  );

  // Gateway not running
  if (!isGatewayRunning) {
    return (
      <div className="flex h-full flex-col items-center justify-center text-center p-8">
        <AlertCircle className="h-12 w-12 text-amber-500 mb-4" />
        <h2 className="text-xl font-semibold mb-2">{t('gateway.notRunning')}</h2>
        <p className="text-muted-foreground max-w-md">{t('gateway.notRunningDesc')}</p>
      </div>
    );
  }

  return (
    <div className="-mx-4 -my-3 flex h-[calc(100%+1.5rem)] flex-col overflow-hidden rounded-2xl relative">
      {/* LightRays background — covers entire Supervisor page (chat + dock) */}
      <LightRays className="z-0" />

      {/* Top bar: character indicator + panel toggle */}
      <div className="relative z-[2] flex shrink-0 items-center justify-between gap-2 px-4 py-3 border-b border-border/40 bg-background/60 backdrop-blur-xl">
        <div className="flex items-center gap-2">
          {selectedId === SUPERVISOR_ID ? (
            <>
              {supervisorEmployee?.avatarImagePath ? (
                <div className="h-7 w-7 rounded-full overflow-hidden shrink-0">
                  <img
                    src={`local-asset://${supervisorEmployee.avatarImagePath}`}
                    alt={supervisorEmployee.name || t('supervisor.title')}
                    className="h-full w-full object-cover object-center"
                    draggable={false}
                  />
                </div>
              ) : (
                <Crown className="h-5 w-5 text-primary" />
              )}
              <h1 className="text-xl font-bold tracking-wide">
                {supervisorEmployee?.name || t('supervisor.title')}
              </h1>
            </>
          ) : selectedEmployee ? (
            <>
              {selectedEmployee.avatarImagePath ? (
                <div className="h-7 w-7 rounded-full overflow-hidden shrink-0">
                  <img
                    src={`local-asset://${selectedEmployee.avatarImagePath}`}
                    alt={selectedEmployee.name}
                    className="h-full w-full object-cover object-center"
                    draggable={false}
                  />
                </div>
              ) : (
                <span className="text-xl">{selectedEmployee.avatar || '\uD83E\uDD16'}</span>
              )}
              <h1 className="text-xl font-bold tracking-wide">{selectedEmployee.name}</h1>
              <span className="text-xs text-muted-foreground">{selectedEmployee.role}</span>
            </>
          ) : null}
        </div>

        <div className="flex items-center gap-1">
          {/* Chat toolbar buttons (new session, refresh, thinking toggle) */}
          <ChatToolbar hideSessionSelector />

          {/* Panel toggle (visible on md+) */}
          <Button
            variant="ghost"
            size="icon"
            className="hidden md:flex h-7 w-7 rounded-lg"
            onClick={() => setPanelOpen(!panelOpen)}
          >
            {panelOpen ? (
              <PanelRightClose className="h-4 w-4 text-muted-foreground" />
            ) : (
              <PanelRightOpen className="h-4 w-4 text-muted-foreground" />
            )}
          </Button>
        </div>
      </div>

      {/* Main area: Chat + Orchestration Panel */}
      <div className="relative z-[1] flex flex-1 min-h-0">
        {/* Chat area */}
        <div className={cn('flex-1 min-w-0', activating && 'opacity-50 pointer-events-none')}>
          <Chat
            externalSession
            hideToolbar
            hideBackground
            employeeName={
              selectedId === SUPERVISOR_ID
                ? (supervisorEmployee?.name || t('supervisor.title'))
                : selectedEmployee?.name
            }
            employeeAvatar={
              selectedId === SUPERVISOR_ID
                ? (supervisorEmployee?.avatar || '\uD83D\uDC54')
                : selectedEmployee?.avatar
            }
            employeeAvatarImage={
              selectedId === SUPERVISOR_ID
                ? supervisorEmployee?.avatarImagePath
                : selectedEmployee?.avatarImagePath
            }
          />
        </div>

        {/* Orchestration Panel (right) — hidden on small screens, resizable */}
        <AnimatePresence initial={false}>
          {panelOpen && (
            <motion.div
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: panelWidth, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={
                isDraggingPanel
                  ? { duration: 0 }
                  : { type: 'spring', stiffness: 300, damping: 30 }
              }
              className="hidden md:block shrink-0 overflow-hidden relative"
            >
              <PanelResizeHandle
                isDragging={isDraggingPanel}
                onMouseDown={handlePanelMouseDown}
                onDoubleClick={handlePanelDoubleClick}
              />
              <OrchestrationPanel className="w-full h-full" />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Activating overlay */}
      {activating && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/40 z-10">
          <LoadingSpinner size="lg" />
        </div>
      )}

      {/* MessageDock */}
      <div className="relative z-[2] shrink-0 flex justify-center py-2 border-t border-border/40 bg-background/60 backdrop-blur-xl">
        <MessageDock
          characters={dockCharacters}
          selectedId={selectedId}
          onSelect={handleSelect}
          onDeactivate={handleDeactivate}
        />
      </div>
    </div>
  );
}

export default Supervisor;
