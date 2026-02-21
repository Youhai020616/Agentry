/**
 * SkillCard Component
 * Enhanced skill card for the Employee Marketplace
 */
import { motion, AnimatePresence } from 'framer-motion';
import {
  Download,
  Trash2,
  ChevronRight,
  Star,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';
import type { Skill } from '@/types/skill';
import type { SkillType } from '@/types/manifest';

interface SkillCardProps {
  skill: Skill;
  onInstall?: (skillKey: string) => void;
  onUninstall?: (skillKey: string) => void;
  onViewDetails?: (skillKey: string) => void;
  isInstalling?: boolean;
  /** Manifest-level metadata (type, team, pricing) */
  skillType?: SkillType;
  team?: string;
  pricingTier?: 'free' | 'included' | 'premium';
  rating?: number;
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
  isInstalling,
  skillType,
  team,
  pricingTier,
  rating,
}: SkillCardProps) {
  const { t } = useTranslation('marketplace');
  const isInstalled = skill.enabled !== undefined;

  return (
    <Card
      className={cn(
        'rounded-2xl glass-border shadow-island transition-all hover:bg-accent/50 group',
        isInstalled && skill.enabled && 'ring-1 ring-primary/30'
      )}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-xl shrink-0 group-hover:scale-110 transition-transform">
              {skill.icon || '🧩'}
            </div>
            <div className="min-w-0">
              <CardTitle className="text-base truncate group-hover:text-primary transition-colors">
                {skill.name}
              </CardTitle>
              <CardDescription className="text-xs flex items-center gap-1.5 mt-0.5">
                {skill.author && (
                  <span>{t('card.by', { author: skill.author })}</span>
                )}
                {skill.version && (
                  <>
                    {skill.author && <span>-</span>}
                    <span>v{skill.version}</span>
                  </>
                )}
              </CardDescription>
            </div>
          </div>
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

        {/* Actions */}
        <div className="flex items-center gap-2 pt-1">
          {isInstalled ? (
            <>
              {onUninstall && !skill.isCore && !skill.isBundled && (
                <Button
                  variant="destructive"
                  size="sm"
                  className="h-7 text-xs gap-1"
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
              {!onUninstall || skill.isCore || skill.isBundled ? (
                <Badge variant="secondary" className="text-xs h-7 px-2">
                  {t('card.installed')}
                </Badge>
              ) : null}
            </>
          ) : (
            onInstall && (
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
            )
          )}

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
