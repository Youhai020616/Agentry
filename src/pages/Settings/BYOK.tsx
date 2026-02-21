/**
 * BYOK (Bring Your Own Key) Settings
 * Allows users to enable BYOK mode to reduce credit costs
 */
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '@/stores/settings';
import { useProviderStore } from '@/stores/providers';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Key, Info, Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface CreditComparisonRow {
  labelKey: string;
  normal: string;
  byok: string;
}

const CREDIT_COMPARISON: CreditComparisonRow[] = [
  { labelKey: 'comparison.chat', normal: '1 credit/msg', byok: '0 credits' },
  { labelKey: 'comparison.tool', normal: '2 credits/call', byok: '0 credits' },
  { labelKey: 'comparison.execution', normal: '5 credits/run', byok: '0 credits' },
];

export function BYOK() {
  const { t } = useTranslation('billing');
  const { byokEnabled, setByokEnabled } = useSettingsStore();
  const { providers, fetchProviders } = useProviderStore();

  useEffect(() => {
    fetchProviders();
  }, [fetchProviders]);

  const configuredProviders = providers.filter((p) => p.hasKey);
  const hasConfiguredKeys = configuredProviders.length > 0;

  const handleNavigateToProviders = () => {
    // Scroll to the AI Providers section on the settings page
    const providersCard = document.querySelector('[data-section="ai-providers"]');
    if (providersCard) {
      providersCard.scrollIntoView({ behavior: 'smooth' });
    }
  };

  return (
    <div className="space-y-6">
      {/* BYOK Toggle */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Key className="h-5 w-5" />
            {t('byok.title')}
          </CardTitle>
          <CardDescription>{t('byok.description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <Label className="text-base">{t('byok.title')}</Label>
              <p className="text-sm text-muted-foreground">{t('byok.discount')}</p>
            </div>
            <div className="flex items-center gap-3">
              <Badge variant={byokEnabled ? 'default' : 'secondary'}>
                {byokEnabled ? t('byok.enabled') : t('byok.disabled')}
              </Badge>
              <Switch checked={byokEnabled} onCheckedChange={setByokEnabled} />
            </div>
          </div>

          <Separator />

          {/* Provider Keys Status */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <Label>{t('byok.configureKeys')}</Label>
                <p className="text-sm text-muted-foreground">
                  {hasConfiguredKeys
                    ? t('byok.keysConfigured', { count: configuredProviders.length })
                    : t('byok.noKeysConfigured')}
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={handleNavigateToProviders}>
                <Key className="mr-2 h-4 w-4" />
                {t('byok.configureKeys')}
              </Button>
            </div>

            {/* Provider list summary */}
            {providers.length > 0 && (
              <div className="rounded-lg border p-3">
                <div className="space-y-2">
                  {providers.map((provider) => (
                    <div key={provider.id} className="flex items-center justify-between text-sm">
                      <span>{provider.name || provider.id}</span>
                      {provider.hasKey ? (
                        <Badge variant="default" className="text-xs">
                          <Check className="mr-1 h-3 w-3" />
                          Configured
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="text-xs">
                          <X className="mr-1 h-3 w-3" />
                          No Key
                        </Badge>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Info box */}
          {byokEnabled && (
            <>
              <Separator />
              <div className="flex items-start gap-3 rounded-lg border border-primary/20 bg-primary/5 p-4">
                <Info className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                <div className="space-y-1 text-sm">
                  <p className="font-medium">{t('byok.discount')}</p>
                  <p className="text-muted-foreground">{t('byok.comparison.feature')}</p>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Credit Comparison Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('byok.comparison.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-hidden rounded-lg border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="px-4 py-2 text-left font-medium">&nbsp;</th>
                  <th className="px-4 py-2 text-center font-medium">{t('byok.comparison.normal')}</th>
                  <th className="px-4 py-2 text-center font-medium">
                    <span className="flex items-center justify-center gap-1">
                      {t('byok.comparison.byok')}
                      <Key className="h-3 w-3" />
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {CREDIT_COMPARISON.map((row, idx) => (
                  <tr
                    key={row.labelKey}
                    className={cn(idx < CREDIT_COMPARISON.length - 1 && 'border-b')}
                  >
                    <td className="px-4 py-2 font-medium">{t(`byok.${row.labelKey}`)}</td>
                    <td className="px-4 py-2 text-center text-muted-foreground">{row.normal}</td>
                    <td className="px-4 py-2 text-center font-medium text-primary">{row.byok}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{t('byok.comparison.feature')}</p>
        </CardContent>
      </Card>
    </div>
  );
}

export default BYOK;
