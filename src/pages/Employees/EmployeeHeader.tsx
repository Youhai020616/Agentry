/**
 * EmployeeHeader
 * Shows employee info bar at the top of the EmployeeChat page.
 */
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { PixelAvatar } from '@/components/employees/PixelAvatar';
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
}

export function EmployeeHeader({ employee }: EmployeeHeaderProps) {
  const navigate = useNavigate();
  const { t } = useTranslation('employees');

  return (
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
    </div>
  );
}
