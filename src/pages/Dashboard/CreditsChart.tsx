/**
 * CreditsChart Component
 * Credits analytics dashboard with pure CSS charts:
 * - Daily usage bar chart (7/14/30 day toggle)
 * - Per-employee horizontal breakdown bars
 * - Per-type pie chart (CSS conic-gradient)
 * - Balance forecast estimation
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TrendingDown, Users, Layers } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

import { useCreditsStore } from '@/stores/credits';
import { useEmployeesStore } from '@/stores/employees';
import type { CreditTransactionType } from '@/types/credits';

// ── Constants ─────────────────────────────────────────────────────

const RANGE_OPTIONS = [7, 14, 30] as const;
type RangeOption = (typeof RANGE_OPTIONS)[number];

const TYPE_COLORS: Record<string, string> = {
  chat: '#3b82f6', // blue-500
  tool: '#8b5cf6', // violet-500
  execution: '#f59e0b', // amber-500
  pm_orchestration: '#10b981', // emerald-500
  memory: '#ec4899', // pink-500
};

const TYPE_BG_CLASSES: Record<string, string> = {
  chat: 'bg-blue-500',
  tool: 'bg-violet-500',
  execution: 'bg-amber-500',
  pm_orchestration: 'bg-emerald-500',
  memory: 'bg-pink-500',
};

// ── Helpers ───────────────────────────────────────────────────────

function formatDay(dayStr: string): string {
  const date = new Date(dayStr);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

// ── Sub-components ────────────────────────────────────────────────

/** Daily Usage Bar Chart */
function DailyUsageChart({
  range,
  onRangeChange,
}: {
  range: RangeOption;
  onRangeChange: (r: RangeOption) => void;
}) {
  const { t } = useTranslation('dashboard');
  const dailySummary = useCreditsStore((s) => s.dailySummary);

  const maxConsumed = useMemo(() => {
    if (dailySummary.length === 0) return 1;
    return Math.max(...dailySummary.map((d) => d.consumed), 1);
  }, [dailySummary]);

  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold">{t('creditsChart.dailyUsage')}</h3>
        <div className="flex gap-1">
          {RANGE_OPTIONS.map((opt) => (
            <Button
              key={opt}
              variant={range === opt ? 'default' : 'ghost'}
              size="sm"
              className="h-6 px-2 text-xs rounded-md"
              onClick={() => onRangeChange(opt)}
            >
              {t(`creditsChart.days${opt}`)}
            </Button>
          ))}
        </div>
      </div>

      {dailySummary.length === 0 ? (
        <div className="flex items-center justify-center h-40 text-sm text-muted-foreground">
          {t('creditsChart.noData')}
        </div>
      ) : (
        <div className="relative">
          <div className="flex items-end gap-1 h-40">
            {dailySummary.map((day, i) => {
              const heightPercent = (day.consumed / maxConsumed) * 100;
              return (
                <div
                  key={day.day}
                  className="flex-1 flex flex-col items-center gap-1 relative"
                  onMouseEnter={() => setHoveredIndex(i)}
                  onMouseLeave={() => setHoveredIndex(null)}
                >
                  {/* Tooltip */}
                  {hoveredIndex === i && day.consumed > 0 && (
                    <div className="absolute -top-8 left-1/2 -translate-x-1/2 z-10 whitespace-nowrap rounded-md bg-popover border border-border px-2 py-1 text-xs text-popover-foreground shadow-md">
                      {t('creditsChart.credits', { count: day.consumed })}
                    </div>
                  )}
                  {/* Bar */}
                  <div className="w-full flex-1 flex items-end">
                    <div
                      className={cn(
                        'w-full rounded-t transition-all duration-300',
                        hoveredIndex === i ? 'bg-primary' : 'bg-primary/70'
                      )}
                      style={{
                        height: `${Math.max(heightPercent, day.consumed > 0 ? 2 : 0)}%`,
                      }}
                    />
                  </div>
                  {/* X-axis label */}
                  <span className="text-[10px] text-muted-foreground leading-none">
                    {formatDay(day.day)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/** Per-Employee Horizontal Breakdown */
function EmployeeBreakdown() {
  const { t } = useTranslation('dashboard');
  const employees = useEmployeesStore((s) => s.employees);
  const fetchByEmployee = useCreditsStore((s) => s.fetchByEmployee);
  const [employeeCredits, setEmployeeCredits] = useState<
    { id: string; name: string; avatar: string; avatarImagePath?: string; consumed: number }[]
  >([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (employees.length === 0) return;
      setLoading(true);

      const results: { id: string; name: string; avatar: string; avatarImagePath?: string; consumed: number }[] = [];

      for (const emp of employees) {
        const transactions = await fetchByEmployee(emp.id, 200);
        const consumed = transactions.reduce(
          (sum, tx) => sum + (tx.amount < 0 ? Math.abs(tx.amount) : 0),
          0
        );
        results.push({
          id: emp.id,
          name: emp.name,
          avatar: emp.avatar || emp.name.charAt(0).toUpperCase(),
          avatarImagePath: emp.avatarImagePath,
          consumed,
        });
      }

      if (!cancelled) {
        // Sort descending
        results.sort((a, b) => b.consumed - a.consumed);
        setEmployeeCredits(results);
        setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [employees, fetchByEmployee]);

  const totalConsumed = useMemo(
    () => employeeCredits.reduce((sum, e) => sum + e.consumed, 0),
    [employeeCredits]
  );

  if (loading || employees.length === 0) {
    return (
      <div>
        <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
          <Users className="h-4 w-4 text-muted-foreground" />
          {t('creditsChart.byEmployee')}
        </h3>
        <div className="flex items-center justify-center h-24 text-sm text-muted-foreground">
          {employees.length === 0 ? t('creditsChart.noData') : '...'}
        </div>
      </div>
    );
  }

  return (
    <div>
      <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
        <Users className="h-4 w-4 text-muted-foreground" />
        {t('creditsChart.byEmployee')}
      </h3>
      <div className="space-y-3">
        {employeeCredits.map((emp) => {
          const widthPercent = totalConsumed > 0 ? (emp.consumed / totalConsumed) * 100 : 0;
          return (
            <div key={emp.id} className="flex items-center gap-3">
              {emp.avatarImagePath ? (
                <div className="h-6 w-6 rounded-full overflow-hidden"><img src={`local-asset://${emp.avatarImagePath}`} alt={emp.name} className="h-full w-full object-cover" draggable={false} /></div>
              ) : (
                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-xs">{emp.avatar}</div>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium truncate">{emp.name}</span>
                  <span className="text-xs text-muted-foreground shrink-0 ml-2">
                    {emp.consumed}
                  </span>
                </div>
                <div className="h-2 w-full rounded-full bg-muted">
                  <div
                    className="h-2 rounded-full bg-primary transition-all duration-500"
                    style={{ width: `${Math.max(widthPercent, emp.consumed > 0 ? 2 : 0)}%` }}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Per-Type Pie Chart with CSS conic-gradient */
function TypeBreakdown() {
  const { t } = useTranslation('dashboard');
  const { t: tCredits } = useTranslation('credits');
  const fetchByType = useCreditsStore((s) => s.fetchByType);
  const [typeData, setTypeData] = useState<{ type: CreditTransactionType; consumed: number }[]>([]);
  const [loading, setLoading] = useState(false);

  const consumptionTypes: CreditTransactionType[] = [
    'chat',
    'tool',
    'execution',
    'pm_orchestration',
    'memory',
  ];

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      const results: { type: CreditTransactionType; consumed: number }[] = [];

      for (const type of consumptionTypes) {
        const transactions = await fetchByType(type, 500);
        const consumed = transactions.reduce(
          (sum, tx) => sum + (tx.amount < 0 ? Math.abs(tx.amount) : 0),
          0
        );
        results.push({ type, consumed });
      }

      if (!cancelled) {
        setTypeData(results.filter((r) => r.consumed > 0));
        setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchByType]);

  const totalConsumed = useMemo(() => typeData.reduce((sum, d) => sum + d.consumed, 0), [typeData]);

  const conicGradient = useMemo(() => {
    if (typeData.length === 0 || totalConsumed === 0) return 'conic-gradient(hsl(var(--muted)) 0% 100%)';

    let accumulated = 0;
    const segments: string[] = [];

    for (const d of typeData) {
      const percent = (d.consumed / totalConsumed) * 100;
      const color = TYPE_COLORS[d.type] || '#6b7280';
      segments.push(`${color} ${accumulated}% ${accumulated + percent}%`);
      accumulated += percent;
    }

    return `conic-gradient(${segments.join(', ')})`;
  }, [typeData, totalConsumed]);

  if (loading) {
    return (
      <div>
        <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
          <Layers className="h-4 w-4 text-muted-foreground" />
          {t('creditsChart.byType')}
        </h3>
        <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
          ...
        </div>
      </div>
    );
  }

  if (typeData.length === 0) {
    return (
      <div>
        <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
          <Layers className="h-4 w-4 text-muted-foreground" />
          {t('creditsChart.byType')}
        </h3>
        <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
          {t('creditsChart.noData')}
        </div>
      </div>
    );
  }

  return (
    <div>
      <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
        <Layers className="h-4 w-4 text-muted-foreground" />
        {t('creditsChart.byType')}
      </h3>
      <div className="flex items-center gap-6">
        {/* Pie chart */}
        <div
          className="h-32 w-32 shrink-0 rounded-full shadow-sm"
          style={{ background: conicGradient }}
        />
        {/* Legend */}
        <div className="flex flex-col gap-2 min-w-0">
          {typeData.map((d) => {
            const percent = totalConsumed > 0 ? Math.round((d.consumed / totalConsumed) * 100) : 0;
            return (
              <div key={d.type} className="flex items-center gap-2 text-xs">
                <span
                  className={cn('h-2.5 w-2.5 rounded-sm shrink-0', TYPE_BG_CLASSES[d.type] || 'bg-gray-500')}
                />
                <span className="text-muted-foreground truncate">{tCredits(`types.${d.type}`)}</span>
                <span className="text-foreground font-medium ml-auto shrink-0">{percent}%</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** Balance Forecast */
function BalanceForecast() {
  const { t } = useTranslation('dashboard');
  const balance = useCreditsStore((s) => s.balance);
  const dailySummary = useCreditsStore((s) => s.dailySummary);

  const forecast = useMemo(() => {
    if (!balance || dailySummary.length === 0) return null;

    const totalConsumed = dailySummary.reduce((sum, d) => sum + d.consumed, 0);
    const avgDaily = totalConsumed / dailySummary.length;

    if (avgDaily <= 0) return null;

    const daysRemaining = Math.round(balance.remaining / avgDaily);
    return { daysRemaining, avgDaily: Math.round(avgDaily * 10) / 10 };
  }, [balance, dailySummary]);

  if (!forecast) {
    return (
      <div>
        <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
          <TrendingDown className="h-4 w-4 text-muted-foreground" />
          {t('creditsChart.forecast')}
        </h3>
        <div className="flex items-center justify-center h-16 text-sm text-muted-foreground">
          {t('creditsChart.noData')}
        </div>
      </div>
    );
  }

  const colorClass =
    forecast.daysRemaining > 30
      ? 'text-green-500'
      : forecast.daysRemaining >= 7
        ? 'text-yellow-500'
        : 'text-red-500';

  return (
    <div>
      <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
        <TrendingDown className="h-4 w-4 text-muted-foreground" />
        {t('creditsChart.forecast')}
      </h3>
      <div className="flex items-baseline gap-2">
        <span className={cn('text-3xl font-bold tabular-nums', colorClass)}>
          {forecast.daysRemaining}
        </span>
        <span className="text-sm text-muted-foreground">
          {t('creditsChart.daysRemaining', { days: forecast.daysRemaining })}
        </span>
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────

export function CreditsChart() {
  const { t } = useTranslation('dashboard');
  const fetchDailySummary = useCreditsStore((s) => s.fetchDailySummary);
  const [range, setRange] = useState<RangeOption>(7);

  const handleRangeChange = useCallback(
    (newRange: RangeOption) => {
      setRange(newRange);
      fetchDailySummary(newRange);
    },
    [fetchDailySummary]
  );

  useEffect(() => {
    fetchDailySummary(range);
  }, [fetchDailySummary, range]);

  return (
    <div className="bg-card rounded-2xl glass-border shadow-island p-6">
      <h2 className="text-sm font-semibold mb-6">{t('creditsChart.title')}</h2>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        {/* Daily usage bar chart */}
        <DailyUsageChart range={range} onRangeChange={handleRangeChange} />

        {/* Balance forecast */}
        <BalanceForecast />

        {/* Per-employee breakdown */}
        <EmployeeBreakdown />

        {/* Per-type pie chart */}
        <TypeBreakdown />
      </div>
    </div>
  );
}
