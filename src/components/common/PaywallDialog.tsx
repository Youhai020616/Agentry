/**
 * Paywall Dialog
 * Shown when a user attempts to use a premium feature
 */
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Crown, Zap, Users, Check } from 'lucide-react';
import { toast } from 'sonner';

interface PaywallDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  feature: string;
  requiredTier: 'pro' | 'team';
}

const TIER_BENEFITS: Record<'pro' | 'team', string[]> = {
  pro: [
    '10,000 credits/month',
    'Unlimited employees',
    'Tool execution',
    'Priority support',
  ],
  team: [
    '50,000 credits/month',
    'Team collaboration',
    'API access',
    'Custom employees',
    'Dedicated support',
  ],
};

const TIER_ICONS: Record<'pro' | 'team', React.ReactNode> = {
  pro: <Crown className="h-6 w-6 text-primary" />,
  team: <Users className="h-6 w-6 text-primary" />,
};

export function PaywallDialog({ open, onOpenChange, feature, requiredTier }: PaywallDialogProps) {
  const { t } = useTranslation('billing');

  const handleUpgrade = () => {
    toast.info(t('comingSoon'));
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            {TIER_ICONS[requiredTier]}
          </div>
          <DialogTitle className="text-center">{t('paywall.title')}</DialogTitle>
          <DialogDescription className="text-center">
            {t('paywall.description', {
              feature,
              tier: t(`tiers.${requiredTier}.name`),
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-4">
          <p className="text-sm font-medium">
            {t('paywall.benefits', { tier: t(`tiers.${requiredTier}.name`) })}
          </p>
          <ul className="space-y-2">
            {TIER_BENEFITS[requiredTier].map((benefit, idx) => (
              <li key={idx} className="flex items-center gap-2 text-sm">
                <Check className="h-4 w-4 shrink-0 text-primary" />
                <span>{benefit}</span>
              </li>
            ))}
          </ul>
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-col">
          <Button className="w-full" onClick={handleUpgrade}>
            <Zap className="mr-2 h-4 w-4" />
            {t('paywall.upgrade')}
          </Button>
          <Button variant="ghost" className="w-full" onClick={() => onOpenChange(false)}>
            {t('paywall.later')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default PaywallDialog;
