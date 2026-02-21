/**
 * Supervisor Manager Page
 * Full-screen chat view with bottom MessageDock for switching between
 * Supervisor and individual AI employees.
 *
 * Default: Supervisor selected → chat with the PM/orchestration agent.
 * Click employee avatar → switch to that employee's direct chat session.
 */
import { useEffect, useMemo, useCallback, useState } from 'react';
import { Crown, AlertCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';
import { Chat } from '@/pages/Chat';
import { useEmployeesStore } from '@/stores/employees';
import { useChatStore } from '@/stores/chat';
import { useGatewayStore } from '@/stores/gateway';
import { MessageDock, type DockCharacter } from '@/components/ui/message-dock';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';

/** Supervisor uses the default main session */
const SUPERVISOR_SESSION_KEY = 'agent:main:main';
const SUPERVISOR_ID = '__supervisor__';

export function Supervisor() {
  const { t } = useTranslation('common');

  const gatewayStatus = useGatewayStore((s) => s.status);
  const isGatewayRunning = gatewayStatus.state === 'running';

  const employees = useEmployeesStore((s) => s.employees);
  const fetchEmployees = useEmployeesStore((s) => s.fetchEmployees);
  const activateEmployee = useEmployeesStore((s) => s.activateEmployee);
  const init = useEmployeesStore((s) => s.init);

  const switchSession = useChatStore((s) => s.switchSession);

  const [selectedId, setSelectedId] = useState<string>(SUPERVISOR_ID);
  const [activating, setActivating] = useState(false);

  // Initialize employees store
  useEffect(() => {
    init();
    fetchEmployees();
  }, [init, fetchEmployees]);

  // Bind Supervisor session on mount when gateway is ready
  useEffect(() => {
    if (isGatewayRunning && selectedId === SUPERVISOR_ID) {
      switchSession(SUPERVISOR_SESSION_KEY);
    }
  }, [isGatewayRunning]); // eslint-disable-line react-hooks/exhaustive-deps

  // Build dock characters: Supervisor first, then employees
  const dockCharacters: DockCharacter[] = useMemo(() => {
    const supervisor: DockCharacter = {
      id: SUPERVISOR_ID,
      name: t('supervisor.title'),
      avatar: '👔',
      status: 'idle',
    };

    const employeeChars: DockCharacter[] = employees.map((e) => ({
      id: e.id,
      name: e.name,
      avatar: e.avatar || '🤖',
      status: e.status === 'offline' ? 'offline' : e.status,
    }));

    return [supervisor, ...employeeChars];
  }, [employees, t]);

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
        // Switch to supervisor session
        switchSession(SUPERVISOR_SESSION_KEY);
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
    [selectedId, employees, switchSession, activateEmployee]
  );

  // Gateway not running
  if (!isGatewayRunning) {
    return (
      <div className="flex h-full flex-col items-center justify-center text-center p-8">
        <AlertCircle className="h-12 w-12 text-yellow-500 mb-4" />
        <h2 className="text-xl font-semibold mb-2">{t('gateway.notRunning')}</h2>
        <p className="text-muted-foreground max-w-md">{t('gateway.notRunningDesc')}</p>
      </div>
    );
  }

  return (
    <div className="-m-6 flex h-[calc(100%+3rem)] flex-col">
      {/* Active character indicator */}
      <div className="flex shrink-0 items-center gap-2 px-4 py-2 border-b border-border/40">
        {selectedId === SUPERVISOR_ID ? (
          <>
            <Crown className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium">{t('supervisor.title')}</span>
          </>
        ) : selectedEmployee ? (
          <>
            <span className="text-base">{selectedEmployee.avatar || '🤖'}</span>
            <span className="text-sm font-medium">{selectedEmployee.name}</span>
            <span className="text-xs text-muted-foreground">— {selectedEmployee.role}</span>
          </>
        ) : null}
      </div>

      {/* Chat area */}
      <div className={cn('flex-1 min-h-0', activating && 'opacity-50 pointer-events-none')}>
        <Chat
          externalSession
          employeeName={
            selectedId === SUPERVISOR_ID ? t('supervisor.title') : selectedEmployee?.name
          }
          employeeAvatar={selectedId === SUPERVISOR_ID ? '👔' : selectedEmployee?.avatar}
        />
      </div>

      {/* Activating overlay */}
      {activating && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/40 z-10">
          <LoadingSpinner size="lg" />
        </div>
      )}

      {/* MessageDock */}
      <div className="shrink-0 flex justify-center py-2 border-t border-border/40">
        <MessageDock
          characters={dockCharacters}
          selectedId={selectedId}
          onSelect={handleSelect}
        />
      </div>
    </div>
  );
}

export default Supervisor;
