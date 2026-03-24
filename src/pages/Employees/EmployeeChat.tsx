/**
 * EmployeeChat Page
 * Wraps the Chat component with employee context:
 * - Reads :slug from route params to identify the employee
 * - Gates on onboarding: if the employee requires onboarding and it hasn't been completed,
 *   shows the OnboardingWizard instead of the chat
 * - Auto-activates the employee if offline
 * - Binds Chat to the employee's Gateway session
 * - Shows employee info header above the chat
 */
import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, AlertCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { useEmployeesStore } from '@/stores/employees';
import { useChatStore } from '@/stores/chat';
import { useGatewayStore } from '@/stores/gateway';
import { Chat } from '@/pages/Chat';
import { EmployeeHeader } from './EmployeeHeader';
import { OnboardingWizard } from './OnboardingWizard';
import { ExtensionSetupDialog } from './ExtensionSetupDialog';
import type { SkillManifest } from '@/types/manifest';

interface ManifestWithDir extends SkillManifest {
  _skillDir: string;
}

export function EmployeeChat() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation('employees');

  const gatewayStatus = useGatewayStore((s) => s.status);
  const isGatewayRunning = gatewayStatus.state === 'running';

  const employees = useEmployeesStore((s) => s.employees);
  const fetchEmployees = useEmployeesStore((s) => s.fetchEmployees);
  const activateEmployee = useEmployeesStore((s) => s.activateEmployee);
  const init = useEmployeesStore((s) => s.init);

  const switchSession = useChatStore((s) => s.switchSession);
  const newSession = useChatStore((s) => s.newSession);
  const deactivateEmployee = useEmployeesStore((s) => s.deactivateEmployee);

  const [activating, setActivating] = useState(false);

  // Guard: when restarting, prevent auto-bind effect from calling switchSession
  // (which would load old history and override the fresh conversation we just created)
  const restartingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  // Onboarding gate state
  const [needsOnboarding, setNeedsOnboarding] = useState<boolean | null>(null);
  const [manifest, setManifest] = useState<ManifestWithDir | null>(null);

  // Extension dependency gate (for employees without onboarding)
  const [needsExtensions, setNeedsExtensions] = useState(false);
  const [missingExtensions, setMissingExtensions] = useState<string[]>([]);

  const employee = employees.find((e) => e.slug === slug);

  // Initialize store and fetch employees on mount
  useEffect(() => {
    init();
    if (employees.length === 0) {
      fetchEmployees();
    }
  }, [init, fetchEmployees, employees.length]);

  // Check if employee needs onboarding
  useEffect(() => {
    if (!employee) return;

    // If employee doesn't have onboarding requirement, skip
    if (!employee.hasOnboarding) {
      setNeedsOnboarding(false);
      return;
    }

    // If already completed, skip
    if (employee.onboardingCompleted) {
      setNeedsOnboarding(false);
      return;
    }

    // Needs onboarding — fetch manifest for the wizard
    async function fetchManifest() {
      try {
        const result = (await window.electron.ipcRenderer.invoke(
          'employee:getManifest',
          employee!.id
        )) as {
          success: boolean;
          result?: ManifestWithDir;
          error?: string;
        };

        if (result.success && result.result) {
          setManifest(result.result);
          setNeedsOnboarding(true);
        } else {
          // Can't get manifest — allow through to chat
          setNeedsOnboarding(false);
        }
      } catch {
        setNeedsOnboarding(false);
      }
    }

    fetchManifest();
  }, [employee?.id, employee?.hasOnboarding, employee?.onboardingCompleted]); // eslint-disable-line react-hooks/exhaustive-deps

  // Restart handler: deactivate → activate → create fresh conversation
  const handleRestart = useCallback(async () => {
    if (!employee) return;
    restartingRef.current = true;
    try {
      await deactivateEmployee(employee.id);
      // Small delay to let Gateway clean up the old session
      await new Promise((r) => setTimeout(r, 300));
      await activateEmployee(employee.id);
      // Create a brand-new empty conversation so the employee starts fresh
      newSession();
    } finally {
      restartingRef.current = false;
    }
  }, [employee?.id, deactivateEmployee, activateEmployee, newSession]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-activate employee and bind to their session (only when NOT in onboarding)
  useEffect(() => {
    if (!employee || !isGatewayRunning || needsOnboarding !== false || needsExtensions) return;
    // Skip auto-bind while a restart is in progress — the restart handler
    // will create a fresh session itself.
    if (restartingRef.current) return;

    let cancelled = false;

    async function bindSession() {
      try {
        // If employee is offline, check deps first then activate
        if (employee!.status === 'offline') {
          // Check runtime dependencies before activation
          const depsResult = (await window.electron.ipcRenderer.invoke(
            'employee:checkDeps',
            employee!.id
          )) as {
            success: boolean;
            result?: { satisfied: boolean; missing: Array<{ name: string }>; requires: string[] };
          };

          if (depsResult.success && depsResult.result && !depsResult.result.satisfied) {
            if (!cancelled) {
              setMissingExtensions(depsResult.result.requires);
              setNeedsExtensions(true);
            }
            return;
          }

          setActivating(true);
          setError(null);
          await activateEmployee(employee!.id);
          if (cancelled) return;
        }

        // Re-read employee from store (activation updates gatewaySessionKey)
        const updated = useEmployeesStore.getState().employees.find((e) => e.id === employee!.id);

        if (updated?.gatewaySessionKey) {
          switchSession(updated.gatewaySessionKey);
        }
      } catch (err) {
        if (!cancelled) {
          setError(String(err));
        }
      } finally {
        if (!cancelled) {
          setActivating(false);
        }
      }
    }

    // Only bind if employee doesn't have a session yet or is offline
    if (employee.status === 'offline' || employee.gatewaySessionKey) {
      if (employee.gatewaySessionKey) {
        // Already active — just switch session
        switchSession(employee.gatewaySessionKey);
      } else {
        // Needs activation
        bindSession();
      }
    }
  }, [employee?.id, employee?.status, isGatewayRunning, needsOnboarding, needsExtensions]); // eslint-disable-line react-hooks/exhaustive-deps

  // Handle onboarding completion
  const handleOnboardingComplete = useCallback(() => {
    setNeedsOnboarding(false);
    setManifest(null);
    // Refresh employees to get the updated onboardingCompleted flag
    fetchEmployees();
  }, [fetchEmployees]);

  // Handle onboarding cancel — go back to employees
  const handleOnboardingCancel = useCallback(() => {
    navigate('/employees');
  }, [navigate]);

  // Handle extension setup completion — retry activation
  const handleExtensionsReady = useCallback(() => {
    setNeedsExtensions(false);
    setMissingExtensions([]);
  }, []);

  // Handle extension setup skip — proceed anyway
  const handleExtensionsSkip = useCallback(() => {
    setNeedsExtensions(false);
    setMissingExtensions([]);
  }, []);

  // Employee not found
  if (!employee && employees.length > 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 text-center p-8">
        <AlertCircle className="h-12 w-12 text-destructive" />
        <p className="text-muted-foreground">{t('detail.notFound', 'Employee not found')}</p>
        <Button variant="outline" onClick={() => navigate('/employees')}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          {t('detail.backToHub', 'Back to Employee Hub')}
        </Button>
      </div>
    );
  }

  // Still checking onboarding status or loading employee
  if (!employee || needsOnboarding === null) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <LoadingSpinner size="lg" />
        <p className="text-sm text-muted-foreground">{t('common:status.loading', 'Loading...')}</p>
      </div>
    );
  }

  // Extension dependency gate — show setup dialog
  if (needsExtensions && missingExtensions.length > 0) {
    return (
      <ExtensionSetupDialog
        requires={missingExtensions}
        onReady={handleExtensionsReady}
        onSkip={handleExtensionsSkip}
      />
    );
  }

  // Onboarding gate — show wizard instead of chat
  if (needsOnboarding && manifest) {
    return (
      <OnboardingWizard
        manifest={manifest}
        employeeId={employee.id}
        onComplete={handleOnboardingComplete}
        onCancel={handleOnboardingCancel}
      />
    );
  }

  // Loading / activating state
  if (activating) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <LoadingSpinner size="lg" />
        <p className="text-sm text-muted-foreground">
          {t('detail.activating', 'Activating employee...')}
        </p>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 text-center p-8">
        <AlertCircle className="h-12 w-12 text-destructive" />
        <p className="text-sm text-destructive">{error}</p>
        <Button variant="outline" onClick={() => navigate('/employees')}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          {t('detail.backToHub', 'Back to Employee Hub')}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col -m-4">
      <EmployeeHeader employee={employee} onRestart={handleRestart} />
      <div className="flex-1 min-h-0">
        <Chat
          externalSession
          employeeName={employee.name}
          employeeAvatar={employee.avatar}
          employeeAvatarImage={employee.avatarImagePath}
          employeeId={employee.id}
        />
      </div>
    </div>
  );
}
