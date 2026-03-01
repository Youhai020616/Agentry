/**
 * CostView Component
 * Placeholder cost tracking view with mock API cost bar charts.
 * Displays a "coming soon" message alongside hardcoded cost breakdowns.
 */
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { DollarSign } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';

// ---------------------------------------------------------------------------
// Animation Variants
// ---------------------------------------------------------------------------

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.08, delayChildren: 0.1 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.35, ease: [0.25, 0.46, 0.45, 0.94] as const },
  },
} as const;

// ---------------------------------------------------------------------------
// Mock Cost Data
// ---------------------------------------------------------------------------

interface CostEntry {
  service: string;
  amount: number;
  percent: number;
  barColor: string;
}

const MOCK_COSTS: CostEntry[] = [
  {
    service: 'Claude API',
    amount: 12.5,
    percent: 60,
    barColor: 'bg-orange-500',
  },
  {
    service: 'Seedance',
    amount: 15.0,
    percent: 75,
    barColor: 'bg-blue-500',
  },
  {
    service: 'Playwright',
    amount: 0.0,
    percent: 0,
    barColor: 'bg-green-500',
  },
];

// ---------------------------------------------------------------------------
// Sub-Components
// ---------------------------------------------------------------------------

/** Single cost bar row */
function CostBar({ entry }: { entry: CostEntry }) {
  return (
    <motion.div variants={itemVariants} className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{entry.service}</span>
        <span className="text-sm font-semibold tabular-nums">${entry.amount.toFixed(2)}</span>
      </div>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
        <motion.div
          className={cn('h-full rounded-full', entry.barColor)}
          initial={{ width: 0 }}
          animate={{ width: `${entry.percent}%` }}
          transition={{ duration: 0.8, delay: 0.2, ease: 'easeOut' }}
        />
      </div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function CostView() {
  const { t } = useTranslation('media-studio');

  const totalCost = MOCK_COSTS.reduce((sum, c) => sum + c.amount, 0);

  return (
    <motion.div
      className="flex flex-col items-center justify-center py-16"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      {/* Hero icon + text */}
      <motion.div variants={itemVariants} className="text-center mb-10">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-100 dark:bg-amber-500/15">
          <DollarSign className="h-8 w-8 text-amber-600 dark:text-amber-400" />
        </div>
        <h2 className="text-lg font-semibold">{t('cost.title')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t('cost.placeholder')}</p>
      </motion.div>

      {/* Mock cost breakdown card */}
      <motion.div variants={itemVariants} className="w-full max-w-md">
        <div className="rounded-xl border bg-card p-6">
          {/* Header */}
          <div className="flex items-center justify-between mb-5">
            <h3 className="text-sm font-semibold">{t('reports.apiCost')}</h3>
            <Badge variant="secondary" className="rounded-md px-2 py-0.5 text-xs font-mono">
              ${totalCost.toFixed(2)}
            </Badge>
          </div>

          {/* Cost bars */}
          <div className="space-y-4">
            {MOCK_COSTS.map((entry) => (
              <CostBar key={entry.service} entry={entry} />
            ))}
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
