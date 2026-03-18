/**
 * Billing & Subscription Settings
 * Shows current plan, tier comparison, usage, and upgrade options
 */
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useCreditsStore } from '@/stores/credits';
import { useSettingsStore } from '@/stores/settings';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Crown, Zap, Users, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { CreditsChart } from '@/pages/Dashboard/CreditsChart';

type Tier = 'free' | 'pro' | 'team';

interface TierConfig {
  key: Tier;
  icon: React.ReactNode;
  credits: number;
  popular?: boolean;
}

const TIERS: TierConfig[] = [
  { key: 'free', icon: <Zap className="h-5 w-5" />, credits: 1000 },
  { key: 'pro', icon: <Crown className="h-5 w-5" />, credits: 10000, popular: true },
  { key: 'team', icon: <Users className="h-5 w-5" />, credits: 50000 },
];

export function Billing() {
  const { t } = useTranslation('billing');
  const { balance, loading, fetchBalance } = useCreditsStore();
  const byokEnabled = useSettingsStore((s) => s.byokEnabled);

  useEffect(() => {
    fetchBalance();
  }, [fetchBalance]);

  // Default to free tier
  const currentTier: Tier = 'free';

  const usedCredits = balance?.used ?? 0;
  const totalCredits = balance?.total ?? 1000;
  const usagePercent = totalCredits > 0 ? Math.round((usedCredits / totalCredits) * 100) : 0;
  const remainingCredits = balance?.remaining ?? totalCredits - usedCredits;

  const handleUpgrade = () => {
    toast.info(t('comingSoon'));
  };

  return (
    <div className="space-y-6">
      {/* Current Plan & Usage */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Crown className="h-5 w-5" />
            {t('currentPlan')}
          </CardTitle>
          <CardDescription>
            {t('tiers.free.name')}
            {byokEnabled && (
              <Badge variant="secondary" className="ml-2">
                BYOK
              </Badge>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{t('usage')}</span>
              <span className="font-medium">
                {t('usageOf', { used: usedCredits.toLocaleString(), total: totalCredits.toLocaleString() })}
              </span>
            </div>
            <Progress value={usagePercent} className="h-2" />
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{t('usagePercent', { percent: usagePercent })}</span>
              <span>{t('creditsRemaining', { remaining: remainingCredits.toLocaleString() })}</span>
            </div>
          </div>

          <Button variant="link" className="h-auto p-0 text-sm" disabled={loading}>
            {t('history')}
          </Button>
        </CardContent>
      </Card>

      {/* Tier Comparison */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {TIERS.map((tier) => {
          const isCurrent = tier.key === currentTier;
          const features = t(`tiers.${tier.key}.features`, { returnObjects: true }) as string[];

          return (
            <Card
              key={tier.key}
              className={cn(
                'relative flex flex-col',
                isCurrent && 'border-primary shadow-sm',
                tier.popular && !isCurrent && 'border-muted-foreground/30'
              )}
            >
              {tier.popular && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <Badge variant="default" className="text-xs">
                    {t('mostPopular')}
                  </Badge>
                </div>
              )}
              <CardHeader className="pb-4">
                <div className="flex items-center gap-2">
                  {tier.icon}
                  <CardTitle className="text-lg">{t(`tiers.${tier.key}.name`)}</CardTitle>
                </div>
                <div className="flex items-baseline gap-1">
                  <span className="text-3xl font-bold">{t(`tiers.${tier.key}.price`)}</span>
                  <span className="text-sm text-muted-foreground">
                    {t(`tiers.${tier.key}.period`)}
                  </span>
                </div>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col">
                <ul className="flex-1 space-y-2 text-sm">
                  {Array.isArray(features) &&
                    features.map((feature, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                        <span>{feature}</span>
                      </li>
                    ))}
                </ul>

                <Separator className="my-4" />

                {isCurrent ? (
                  <Button variant="outline" disabled className="w-full">
                    {t('current')}
                  </Button>
                ) : (
                  <Button
                    variant={tier.popular ? 'default' : 'outline'}
                    className="w-full"
                    onClick={handleUpgrade}
                  >
                    {t('upgrade')}
                  </Button>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Credits Analytics */}
      <CreditsChart />
    </div>
  );
}

export default Billing;
