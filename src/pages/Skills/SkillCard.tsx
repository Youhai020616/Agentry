/**
 * SkillCard Component
 * Skill Pack card for the Employee Marketplace (talent acquisition focus).
 *
 * Actions shown depend on the pack's activation state:
 *   - installed → "Hire" button
 *   - hired     → "Activate" button
 *   - active    → Display-only badge + "Go to Team" link (runtime ops live in Employees page)
 *   - missingSecrets → "Configure" warning button
 */
import { motion, AnimatePresence } from 'framer-motion';
import {
  Download,
  Trash2,
  ChevronRight,
  Star,
  UserPlus,
  Settings,
  AlertTriangle,
  ExternalLink,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';
import type { Skill } from '@/types/skill';
import type { SkillType } from '@/types/manifest';
import type { SkillPackStatus } from '@shared/types/manifest';

interface SkillCardProps {
  skill: Skill;
  /** Marketplace install (for marketplace tab only) */
  onInstall?: (skillKey: string) => void;
  /** Uninstall / remove (non-builtin only) */
  onUninstall?: (skillKey: string) => void;
  /** View details / configure */
  onViewDetails?: (skillKey: string) => void;
  /** Hire — activate a skill pack as an employee */
  onHire?: (skillKey: string) => void;
  /** Navigate to the Employees page (for active employees) */
  onGoToTeam?: () => void;
  isInstalling?: boolean;
  isHiring?: boolean;
  /** Manifest-level metadata (type, team, pricing) */
  skillType?: SkillType;
  team?: string;
  pricingTier?: 'free' | 'included' | 'premium';
  rating?: number;
  /** Activation status from SkillPackInfo */
  packStatus?: SkillPackStatus;
  /** Whether required secrets are missing */
  missingSecrets?: boolean;
}

const typeColorMap: Record<SkillType, string> = {
  knowledge: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20',
  execution: 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20',
  hybrid: 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20',
};

const pricingColorMap: Record<string, string> = {
  free: 'bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20',
  included: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20',
  premium: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
};

const statusConfig: Record<
  SkillPackStatus,
  { dotColor: string; badgeClass: string; i18nKey: string }
> = {
  active: {
    dotColor: 'bg-green-500',
    badgeClass: 'bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20',
    i18nKey: 'status.active',
  },
  hired: {
    dotColor: 'bg-muted-foreground',
    badgeClass: 'bg-muted/50 text-muted-foreground border-muted',
    i18nKey: 'status.hired',
  },
  installed: {
    dotColor: 'bg-sky-500',
    badgeClass: 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20',
    i18nKey: 'status.installed',
  },
};

function LoadingDots() {
  return (
    <div className="flex items-center justify-center gap-0.5">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="w-1 h-1 bg-current rounded-full"
          animate={{
            opacity: [0.3, 1, 0.3],
            scale: [0.8, 1, 0.8],
          }}
          transition={{
            duration: 0.8,
            repeat: Infinity,
            delay: i * 0.15,
          }}
        />
      ))}
    </div>
  );
}

export function SkillCard({
  skill,
  onInstall,
  onUninstall,
  onViewDetails,
  onHire,
  onGoToTeam,
  isInstalling,
  isHiring,
  skillType,
  team,
  pricingTier,
  rating,
  packStatus,
  missingSecrets,
}: SkillCardProps) {
  const { t } = useTranslation('marketplace');
  const { t: ts } = useTranslation('skills');

  // For marketplace tab cards that have not been installed yet
  const isMarketplaceCard = skill.enabled === undefined && !packStatus;

  return (
    <Card
      className={cn(
        'rounded-2xl glass-border shadow-island transition-all hover:bg-accent/50 group relative',
        packStatus === 'active' && 'ring-1 ring-green-500/30',
        packStatus === 'hired' && 'ring-1 ring-primary/20'
      )}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className={cn(
                'h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-xl shrink-0 group-hover:scale-110 transition-transform',
                packStatus === 'active' && 'ring-2 ring-green-500/30'
              )}
            >
              {skill.icon || '🧩'}
            </div>
            <div className="min-w-0">
              <CardTitle className="text-base truncate group-hover:text-primary transition-colors">
                {skill.name}
              </CardTitle>
              <CardDescription className="text-xs flex items-center gap-1.5 mt-0.5">
                {skill.author && <span>{t('card.by', { author: skill.author })}</span>}
                {skill.version && (
                  <>
                    {skill.author && <span>-</span>}
                    <span>v{skill.version}</span>
                  </>
                )}
              </CardDescription>
            </div>
          </div>

          {/* Status badge — top right */}
          {packStatus && (
            <div className="flex items-center gap-1.5 shrink-0 ml-2">
              {missingSecrets && (
                <AlertTriangle
                  className="h-4 w-4 text-amber-500"
                  aria-label={ts('status.missingSecrets', { defaultValue: 'Needs configuration' })}
                />
              )}
              <Badge
                variant="outline"
                className={cn(
                  'text-[10px] px-1.5 py-0 h-5 font-normal gap-1',
                  statusConfig[packStatus].badgeClass
                )}
              >
                <span
                  className={cn(
                    'inline-block h-1.5 w-1.5 rounded-full',
                    statusConfig[packStatus].dotColor
                  )}
                />
                {ts(statusConfig[packStatus].i18nKey, {
                  defaultValue: packStatus,
                })}
              </Badge>
            </div>
          )}
        </div>

        {/* Badges row */}
        <div className="flex flex-wrap gap-1.5 mt-2">
          {team && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5 font-normal">
              {t(`categories.${team}`, { defaultValue: team })}
            </Badge>
          )}
          {skillType && (
            <Badge
              variant="outline"
              className={cn('text-[10px] px-1.5 py-0 h-5 font-normal', typeColorMap[skillType])}
            >
              {t(`card.type.${skillType}`, { defaultValue: skillType })}
            </Badge>
          )}
          {pricingTier && (
            <Badge
              variant="outline"
              className={cn(
                'text-[10px] px-1.5 py-0 h-5 font-normal',
                pricingColorMap[pricingTier] || pricingColorMap.free
              )}
            >
              {t(`filters.${pricingTier}`, { defaultValue: pricingTier })}
            </Badge>
          )}
          {skill.isBundled && (
            <Badge
              variant="outline"
              className="text-[10px] px-1.5 py-0 h-5 font-normal bg-muted/30"
            >
              {ts('detail.bundled', { defaultValue: 'Built-in' })}
            </Badge>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground line-clamp-2">{skill.description}</p>

        {/* Rating */}
        {rating !== undefined && rating > 0 && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
            <span>{rating.toFixed(1)}</span>
          </div>
        )}

        {/* Missing secrets warning */}
        {missingSecrets && packStatus && packStatus !== 'active' && (
          <div className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400 bg-amber-500/10 rounded-md px-2 py-1">
            <AlertTriangle className="h-3 w-3 shrink-0" />
            <span>{ts('status.missingSecrets', { defaultValue: 'Missing configuration' })}</span>
          </div>
        )}

        {/* ─── Actions ─────────────────────────────────────────────── */}
        <div className="flex items-center gap-2 pt-1">
          {/* ── Active employee — display-only, link to Employees page ── */}
          {packStatus === 'active' && onGoToTeam && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1"
              onClick={(e) => {
                e.stopPropagation();
                onGoToTeam();
              }}
            >
              <ExternalLink className="h-3 w-3" />
              {t('card.goToTeam', { defaultValue: 'Go to Team' })}
            </Button>
          )}

          {/* ── Hired (offline) employee — activate button ── */}
          {packStatus === 'hired' && (
            <>
              {missingSecrets && onViewDetails ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs gap-1 border-amber-500/30 text-amber-600 dark:text-amber-400 hover:bg-amber-500/10"
                  onClick={(e) => {
                    e.stopPropagation();
                    onViewDetails(skill.id);
                  }}
                >
                  <Settings className="h-3 w-3" />
                  {t('card.configure', { defaultValue: 'Configure' })}
                </Button>
              ) : onHire ? (
                <Button
                  variant="default"
                  size="sm"
                  className="h-7 text-xs gap-1"
                  onClick={(e) => {
                    e.stopPropagation();
                    onHire(skill.id);
                  }}
                  disabled={isHiring}
                >
                  <AnimatePresence mode="wait">
                    {isHiring ? (
                      <LoadingDots />
                    ) : (
                      <>
                        <UserPlus className="h-3 w-3" />
                        {t('card.activate', { defaultValue: 'Activate' })}
                      </>
                    )}
                  </AnimatePresence>
                </Button>
              ) : null}
            </>
          )}

          {/* ── Installed (not yet discovered) — hire button ── */}
          {packStatus === 'installed' && (
            <>
              {onHire && (
                <Button
                  variant="default"
                  size="sm"
                  className="h-7 text-xs gap-1"
                  onClick={(e) => {
                    e.stopPropagation();
                    onHire(skill.id);
                  }}
                  disabled={isHiring}
                >
                  <AnimatePresence mode="wait">
                    {isHiring ? (
                      <LoadingDots />
                    ) : (
                      <>
                        <UserPlus className="h-3 w-3" />
                        {t('card.hire', { defaultValue: 'Hire' })}
                      </>
                    )}
                  </AnimatePresence>
                </Button>
              )}
            </>
          )}

          {/* ── Marketplace card (not installed yet) — install button ── */}
          {isMarketplaceCard && onInstall && (
            <Button
              variant="default"
              size="sm"
              className="h-7 text-xs gap-1"
              onClick={(e) => {
                e.stopPropagation();
                onInstall(skill.id);
              }}
              disabled={isInstalling}
            >
              <AnimatePresence mode="wait">
                {isInstalling ? (
                  <LoadingDots />
                ) : (
                  <>
                    <Download className="h-3 w-3" />
                    {t('card.install')}
                  </>
                )}
              </AnimatePresence>
            </Button>
          )}

          {/* ── Uninstall (non-builtin, non-core only) ── */}
          {packStatus && !skill.isCore && !skill.isBundled && onUninstall && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs gap-1 text-muted-foreground hover:text-destructive"
              onClick={(e) => {
                e.stopPropagation();
                onUninstall(skill.id);
              }}
              disabled={isInstalling}
            >
              {isInstalling ? (
                <LoadingDots />
              ) : (
                <>
                  <Trash2 className="h-3 w-3" />
                  {t('card.uninstall')}
                </>
              )}
            </Button>
          )}

          {/* ── View details (always available, pushed to the right) ── */}
          {onViewDetails && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs gap-1 ml-auto"
              onClick={(e) => {
                e.stopPropagation();
                onViewDetails(skill.id);
              }}
            >
              {t('card.details')}
              <ChevronRight className="h-3 w-3" />
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
