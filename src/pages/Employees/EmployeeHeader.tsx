/**
 * EmployeeHeader
 * Shows employee info bar at the top of the EmployeeChat page.
 * Includes Restart (deactivate→reactivate) and Settings buttons.
 */
import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, RotateCcw, Settings, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { PixelAvatar } from '@/components/employees/PixelAvatar';
import { EmployeeSecrets } from './EmployeeSecrets';
import { useEmployeesStore } from '@/stores/employees';
import type { Employee, EmployeeStatus } from '@/types/employee';

const statusVariant: Record<
  EmployeeStatus,
  'success' | 'default' | 'warning' | 'destructive' | 'secondary'
> = {
  idle: 'secondary',
  working: 'success',
  blocked: 'warning',
  error: 'destructive',
  offline: 'secondary',
};

interface EmployeeHeaderProps {
  employee: Employee;
  onRestart?: () => Promise<void>;
}

export function EmployeeHeader({ employee, onRestart }: EmployeeHeaderProps) {
  const navigate = useNavigate();
  const { t } = useTranslation('employees');

  const deactivateEmployee = useEmployeesStore((s) => s.deactivateEmployee);
  const activateEmployee = useEmployeesStore((s) => s.activateEmployee);

  const [restarting, setRestarting] = useState(false);
  const [showSecrets, setShowSecrets] = useState(false);

  // Restart = deactivate then re-activate (recompiles system prompt from SKILL.md)
  // When onRestart is provided, delegate to parent (EmployeeChat) so it can also
  // create a fresh conversation instead of reloading old chat history.
  const handleRestart = useCallback(async () => {
    if (restarting) return;
    setRestarting(true);
    try {
      if (onRestart) {
        await onRestart();
      } else {
        // Fallback: simple deactivate + activate without new conversation
        await deactivateEmployee(employee.id);
        await new Promise((r) => setTimeout(r, 300));
        await activateEmployee(employee.id);
      }
    } catch {
      // errors are set in the store; no need to handle here
    } finally {
      setRestarting(false);
    }
  }, [employee.id, deactivateEmployee, activateEmployee, restarting, onRestart]);

  // Parse manifest secrets for the settings dialog
  const [manifestSecrets, setManifestSecrets] = useState<
    Record<string, { required: boolean; description: string; obtainUrl?: string }>
  >({});
  const [currentSecrets, setCurrentSecrets] = useState<Record<string, string>>({});

  const handleOpenSecrets = useCallback(async () => {
    try {
      const manifestResult = (await window.electron.ipcRenderer.invoke(
        'employee:getManifest',
        employee.id
      )) as { success: boolean; result?: { secrets?: Record<string, unknown> } };
      if (manifestResult.success && manifestResult.result?.secrets) {
        setManifestSecrets(
          manifestResult.result.secrets as Record<
            string,
            { required: boolean; description: string; obtainUrl?: string }
          >
        );
      }

      const secretsResult = (await window.electron.ipcRenderer.invoke(
        'employee:getSecrets',
        employee.id
      )) as { success: boolean; result?: Record<string, string> };
      if (secretsResult.success && secretsResult.result) {
        setCurrentSecrets(secretsResult.result);
      }
    } catch {
      // non-fatal
    }
    setShowSecrets(true);
  }, [employee.id]);

  return (
    <>
      <div className="flex shrink-0 items-center gap-3 px-4 py-2.5 bg-card glass-border">
        {/* Back button */}
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          onClick={() => navigate('/employees')}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>

        {/* Avatar */}
        <PixelAvatar
          avatar={employee.avatar || employee.name.charAt(0).toUpperCase()}
          status={employee.status}
          size="lg"
        />

        {/* Name + Role */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-semibold">{employee.name}</h3>
            {employee.team && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                {employee.team}
              </Badge>
            )}
          </div>
          <p className="truncate text-xs text-muted-foreground">{employee.role}</p>
        </div>

        {/* Status badge */}
        <Badge variant={statusVariant[employee.status]} className="rounded-full px-3">
          {t(`status.${employee.status}`)}
        </Badge>

        {/* Settings button */}
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0 hover:bg-accent"
          onClick={handleOpenSecrets}
          title={t('card.settings')}
        >
          <Settings className="h-4 w-4" />
        </Button>

        {/* Restart button — deactivate + reactivate to refresh system prompt */}
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0 hover:bg-accent"
          onClick={handleRestart}
          disabled={restarting || employee.status === 'working'}
          title={t('header.restart', 'Restart Employee')}
        >
          {restarting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RotateCcw className="h-4 w-4" />
          )}
        </Button>
      </div>

      {/* Secrets / Settings dialog */}
      <EmployeeSecrets
        open={showSecrets}
        onOpenChange={setShowSecrets}
        employeeId={employee.id}
        employeeName={employee.name}
        requiredSecrets={manifestSecrets}
        currentSecrets={currentSecrets}
      />
    </>
  );
}
