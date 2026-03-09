/**
 * Skills Page — Employee Marketplace
 * Browse, search, filter, and manage AI skills / employees
 */
import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search,
  RefreshCw,
  Lock,
  Package,
  X,
  CheckCircle2,
  XCircle,
  AlertCircle,
  ShieldCheck,
  ChevronRight,
  Sparkles,
  Download,
  Trash2,
  Globe,
  FileCode,
  Plus,
  Save,
  Key,
  ChevronDown,
  FolderOpen,
  Wrench,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useSkillsStore } from '@/stores/skills';
import { useGatewayStore } from '@/stores/gateway';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { toast } from 'sonner';
import type { Skill, MarketplaceSkill } from '@/types/skill';
import type { SkillType } from '@/types/manifest';
import { useTranslation } from 'react-i18next';
import { SkillCard } from './SkillCard';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TypeFilter = 'all' | SkillType;
type PricingFilter = 'all' | 'free' | 'included' | 'premium';
type TeamFilter = 'all' | string;

// ---------------------------------------------------------------------------
// Skill Detail Dialog (kept from original)
// ---------------------------------------------------------------------------

interface SkillDetailDialogProps {
  skill: Skill;
  onClose: () => void;
  onToggle: (enabled: boolean) => void;
}

function SkillDetailDialog({ skill, onClose, onToggle }: SkillDetailDialogProps) {
  const { t } = useTranslation('skills');
  const { fetchSkills } = useSkillsStore();
  const [activeTab, setActiveTab] = useState('info');
  const [envVars, setEnvVars] = useState<Array<{ key: string; value: string }>>([]);
  const [apiKey, setApiKey] = useState('');
  const [isEnvExpanded, setIsEnvExpanded] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (skill.config?.apiKey) {
      setApiKey(String(skill.config.apiKey));
    } else {
      setApiKey('');
    }

    if (skill.config?.env) {
      const vars = Object.entries(skill.config.env).map(([key, value]) => ({
        key,
        value: String(value),
      }));
      setEnvVars(vars);
    } else {
      setEnvVars([]);
    }
  }, [skill.config]);

  const handleOpenClawhub = async () => {
    if (skill.slug) {
      await window.electron.ipcRenderer.invoke(
        'shell:openExternal',
        `https://clawhub.ai/s/${skill.slug}`
      );
    }
  };

  const handleOpenEditor = async () => {
    if (skill.slug) {
      try {
        const result = (await window.electron.ipcRenderer.invoke(
          'clawhub:openSkillReadme',
          skill.slug
        )) as { success: boolean; error?: string };
        if (result.success) {
          toast.success(t('toast.openedEditor'));
        } else {
          toast.error(result.error || t('toast.failedEditor'));
        }
      } catch (err) {
        toast.error(t('toast.failedEditor') + ': ' + String(err));
      }
    }
  };

  const handleAddEnv = () => {
    setEnvVars([...envVars, { key: '', value: '' }]);
  };

  const handleUpdateEnv = (index: number, field: 'key' | 'value', value: string) => {
    const newVars = [...envVars];
    newVars[index] = { ...newVars[index], [field]: value };
    setEnvVars(newVars);
  };

  const handleRemoveEnv = (index: number) => {
    const newVars = [...envVars];
    newVars.splice(index, 1);
    setEnvVars(newVars);
  };

  const handleSaveConfig = async () => {
    if (isSaving) return;
    setIsSaving(true);
    try {
      const envObj = envVars.reduce(
        (acc, curr) => {
          const key = curr.key.trim();
          const value = curr.value.trim();
          if (key) {
            acc[key] = value;
          }
          return acc;
        },
        {} as Record<string, string>
      );

      const result = (await window.electron.ipcRenderer.invoke('skill:updateConfig', {
        skillKey: skill.id,
        apiKey: apiKey || '',
        env: envObj,
      })) as { success: boolean; error?: string };

      if (!result.success) {
        throw new Error(result.error || 'Unknown error');
      }

      await fetchSkills();
      toast.success(t('detail.configSaved'));
    } catch (err) {
      toast.error(t('toast.failedSave') + ': ' + String(err));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <Card
        className="w-full max-w-2xl max-h-[90vh] flex flex-col rounded-2xl glass-border shadow-island-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <CardHeader className="flex flex-row items-start justify-between pb-2">
          <div className="flex items-center gap-4">
            <span className="text-4xl">{skill.icon || '🔧'}</span>
            <div>
              <CardTitle className="flex items-center gap-2">
                {skill.name}
                {skill.isCore && <Lock className="h-4 w-4 text-muted-foreground" />}
              </CardTitle>
              <div className="flex gap-2 mt-2">
                {skill.slug && !skill.isBundled && !skill.isCore && (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs gap-1"
                      onClick={handleOpenClawhub}
                    >
                      <Globe className="h-3 w-3" />
                      ClawHub
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs gap-1"
                      onClick={handleOpenEditor}
                    >
                      <FileCode className="h-3 w-3" />
                      {t('detail.openManual')}
                    </Button>
                  </>
                )}
              </div>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </CardHeader>

        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className="flex-1 flex flex-col min-h-0"
        >
          <div className="px-6">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="info">{t('detail.info')}</TabsTrigger>
              <TabsTrigger value="config" disabled={skill.isCore}>
                {t('detail.config')}
              </TabsTrigger>
            </TabsList>
          </div>

          <div className="flex-1 overflow-y-auto">
            <div className="p-6">
              <TabsContent value="info" className="mt-0 space-y-4">
                <div className="space-y-4">
                  <div>
                    <h3 className="text-sm font-medium text-muted-foreground">
                      {t('detail.description')}
                    </h3>
                    <p className="text-sm mt-1">{skill.description}</p>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <h3 className="text-sm font-medium text-muted-foreground">
                        {t('detail.version')}
                      </h3>
                      <p className="font-mono text-sm">{skill.version}</p>
                    </div>
                    {skill.author && (
                      <div>
                        <h3 className="text-sm font-medium text-muted-foreground">
                          {t('detail.author')}
                        </h3>
                        <p className="text-sm">{skill.author}</p>
                      </div>
                    )}
                  </div>

                  <div>
                    <h3 className="text-sm font-medium text-muted-foreground">
                      {t('detail.source')}
                    </h3>
                    <Badge variant="secondary" className="mt-1 font-normal">
                      {skill.isCore
                        ? t('detail.coreSystem')
                        : skill.isBundled
                          ? t('detail.bundled')
                          : t('detail.userInstalled')}
                    </Badge>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="config" className="mt-0 space-y-6">
                <div className="space-y-6">
                  <div className="space-y-2">
                    <h3 className="text-sm font-medium flex items-center gap-2">
                      <Key className="h-4 w-4 text-primary" />
                      API Key
                    </h3>
                    <Input
                      placeholder={t('detail.apiKeyPlaceholder')}
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      type="password"
                      className="font-mono text-sm"
                    />
                    <p className="text-xs text-muted-foreground">{t('detail.apiKeyDesc')}</p>
                  </div>

                  <div className="space-y-2 border rounded-md p-3">
                    <div className="flex items-center justify-between w-full">
                      <button
                        className="flex items-center gap-2 text-sm font-medium hover:text-primary transition-colors"
                        onClick={() => setIsEnvExpanded(!isEnvExpanded)}
                      >
                        {isEnvExpanded ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                        Environment Variables
                        <Badge variant="secondary" className="px-1.5 py-0 text-[10px] h-5">
                          {envVars.length}
                        </Badge>
                      </button>

                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-[10px] gap-1 px-2"
                        onClick={(e) => {
                          e.stopPropagation();
                          setIsEnvExpanded(true);
                          handleAddEnv();
                        }}
                      >
                        <Plus className="h-3 w-3" />
                        {t('detail.addVariable')}
                      </Button>
                    </div>

                    {isEnvExpanded && (
                      <div className="pt-4 space-y-3 animate-in fade-in slide-in-from-top-2 duration-200">
                        {envVars.length === 0 && (
                          <p className="text-xs text-muted-foreground italic h-8 flex items-center">
                            {t('detail.noEnvVars')}
                          </p>
                        )}

                        {envVars.map((env, index) => (
                          <div key={index} className="flex items-center gap-2">
                            <Input
                              value={env.key}
                              onChange={(e) => handleUpdateEnv(index, 'key', e.target.value)}
                              className="flex-1 font-mono text-xs bg-muted/20"
                              placeholder={t('detail.keyPlaceholder')}
                            />
                            <span className="text-muted-foreground ml-1 mr-1">=</span>
                            <Input
                              value={env.value}
                              onChange={(e) => handleUpdateEnv(index, 'value', e.target.value)}
                              className="flex-1 font-mono text-xs bg-muted/20"
                              placeholder={t('detail.valuePlaceholder')}
                            />
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive hover:bg-destructive/10"
                              onClick={() => handleRemoveEnv(index)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        ))}

                        {envVars.length > 0 && (
                          <p className="text-[10px] text-muted-foreground italic px-1 pt-1">
                            {t('detail.envNote')}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                <div className="pt-4 flex justify-end">
                  <Button onClick={handleSaveConfig} className="gap-2" disabled={isSaving}>
                    <Save className="h-4 w-4" />
                    {isSaving ? t('detail.saving') : t('detail.saveConfig')}
                  </Button>
                </div>
              </TabsContent>
            </div>
          </div>

          <div className="flex items-center justify-between p-4 border-t bg-muted/10">
            <div className="flex items-center gap-2">
              {skill.enabled ? (
                <>
                  <CheckCircle2 className="h-5 w-5 text-green-500" />
                  <span className="text-green-600 dark:text-green-400">{t('detail.enabled')}</span>
                </>
              ) : (
                <>
                  <XCircle className="h-5 w-5 text-muted-foreground" />
                  <span className="text-muted-foreground">{t('detail.disabled')}</span>
                </>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={skill.enabled}
                onCheckedChange={() => onToggle(!skill.enabled)}
                disabled={skill.isCore}
              />
            </div>
          </div>
        </Tabs>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Marketplace Skill Card (from ClawHub search results)
// ---------------------------------------------------------------------------

interface MarketplaceSkillCardProps {
  skill: MarketplaceSkill;
  isInstalling: boolean;
  isInstalled: boolean;
  onInstall: () => void;
  onUninstall: () => void;
}

function MarketplaceSkillCard({
  skill,
  isInstalling,
  isInstalled,
  onInstall,
  onUninstall,
}: MarketplaceSkillCardProps) {
  const handleCardClick = () => {
    window.electron.ipcRenderer.invoke('shell:openExternal', `https://clawhub.ai/s/${skill.slug}`);
  };

  return (
    <Card
      className="rounded-2xl glass-border shadow-island transition-colors cursor-pointer group hover:bg-accent/50"
      onClick={handleCardClick}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-xl group-hover:scale-110 transition-transform">
              📦
            </div>
            <div>
              <CardTitle className="text-base group-hover:text-primary transition-colors">
                {skill.name}
              </CardTitle>
              <CardDescription className="text-xs flex items-center gap-2">
                <span>v{skill.version}</span>
                {skill.author && (
                  <>
                    <span>-</span>
                    <span>{skill.author}</span>
                  </>
                )}
              </CardDescription>
            </div>
          </div>
          <div onClick={(e) => e.stopPropagation()}>
            <AnimatePresence mode="wait">
              {isInstalled ? (
                <motion.div
                  key="uninstall"
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                >
                  <Button
                    variant="destructive"
                    size="icon"
                    className="h-8 w-8"
                    onClick={onUninstall}
                    disabled={isInstalling}
                    asChild
                  >
                    <motion.button whileTap={{ scale: 0.9 }}>
                      {isInstalling ? (
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
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </motion.button>
                  </Button>
                </motion.div>
              ) : (
                <motion.div
                  key="install"
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                >
                  <Button
                    variant="default"
                    size="icon"
                    className="h-8 w-8"
                    onClick={onInstall}
                    disabled={isInstalling}
                    asChild
                  >
                    <motion.button whileTap={{ scale: 0.9 }}>
                      {isInstalling ? (
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
                      ) : (
                        <Download className="h-4 w-4" />
                      )}
                    </motion.button>
                  </Button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground line-clamp-2 mb-3">{skill.description}</p>
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          {skill.downloads !== undefined && (
            <div className="flex items-center gap-1">
              <Download className="h-3 w-3" />
              {skill.downloads.toLocaleString()}
            </div>
          )}
          {skill.stars !== undefined && (
            <div className="flex items-center gap-1">
              <Sparkles className="h-3 w-3" />
              {skill.stars.toLocaleString()}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Helper: derive metadata from a Skill for SkillCard badges
// ---------------------------------------------------------------------------

type PricingTierLiteral = 'free' | 'included' | 'premium';

function deriveSkillMeta(skill: Skill): {
  skillType: SkillType | undefined;
  team: string | undefined;
  pricingTier: PricingTierLiteral | undefined;
  rating: number | undefined;
} {
  const config = skill.config as Record<string, unknown> | undefined;
  const skillType = (config?.type as SkillType) || undefined;
  const team = (config?.team as string) || undefined;
  const pricingRaw = config?.pricingModel as string | undefined;
  const pricingTier: PricingTierLiteral | undefined =
    pricingRaw === 'free' || pricingRaw === 'included' || pricingRaw === 'premium'
      ? pricingRaw
      : undefined;
  const rating = (config?.rating as number) || undefined;
  return { skillType, team, pricingTier, rating };
}

// ---------------------------------------------------------------------------
// Main Skills Page
// ---------------------------------------------------------------------------

export function Skills() {
  const {
    skills,
    loading,
    error,
    fetchSkills,
    enableSkill,
    disableSkill,
    searchResults,
    searchSkills,
    installSkill,
    uninstallSkill,
    searching,
    searchError,
    installing,
  } = useSkillsStore();
  const { t } = useTranslation('skills');
  const { t: tm } = useTranslation('marketplace');
  const gatewayStatus = useGatewayStore((state) => state.status);

  // Local UI state
  const [searchQuery, setSearchQuery] = useState('');
  const [marketplaceQuery, setMarketplaceQuery] = useState('');
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);
  const [activeTab, setActiveTab] = useState('all');
  const [selectedSource, setSelectedSource] = useState<'all' | 'built-in' | 'marketplace'>('all');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [pricingFilter, setPricingFilter] = useState<PricingFilter>('all');
  const [teamFilter, setTeamFilter] = useState<TeamFilter>('all');
  const marketplaceDiscoveryAttemptedRef = useRef(false);

  const isGatewayRunning = gatewayStatus.state === 'running';
  const [showGatewayWarning, setShowGatewayWarning] = useState(false);

  // Debounce the gateway warning
  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (!isGatewayRunning) {
      timer = setTimeout(() => {
        setShowGatewayWarning(true);
      }, 1500);
    } else {
      timer = setTimeout(() => {
        setShowGatewayWarning(false);
      }, 0);
    }
    return () => clearTimeout(timer);
  }, [isGatewayRunning]);

  // Fetch skills on mount
  useEffect(() => {
    if (isGatewayRunning) {
      fetchSkills();
    }
  }, [fetchSkills, isGatewayRunning]);

  // Derive unique teams from loaded skills for filter pills
  const availableTeams = useMemo(() => {
    const teams = new Set<string>();
    skills.forEach((s) => {
      const team = (s.config as Record<string, unknown> | undefined)?.team as string | undefined;
      if (team) teams.add(team);
    });
    return Array.from(teams).sort();
  }, [skills]);

  // Filter installed skills
  const filteredSkills = useMemo(() => {
    return skills
      .filter((skill) => {
        // Text search
        const q = searchQuery.toLowerCase();
        const matchesSearch =
          !q || skill.name.toLowerCase().includes(q) || skill.description.toLowerCase().includes(q);

        // Source filter
        let matchesSource = true;
        if (selectedSource === 'built-in') {
          matchesSource = !!skill.isBundled;
        } else if (selectedSource === 'marketplace') {
          matchesSource = !skill.isBundled;
        }

        // Type filter
        const meta = deriveSkillMeta(skill);
        const matchesType = typeFilter === 'all' || meta.skillType === typeFilter;

        // Pricing filter
        const matchesPricing = pricingFilter === 'all' || meta.pricingTier === pricingFilter;

        // Team filter
        const matchesTeam = teamFilter === 'all' || meta.team === teamFilter;

        return matchesSearch && matchesSource && matchesType && matchesPricing && matchesTeam;
      })
      .sort((a, b) => {
        if (a.enabled && !b.enabled) return -1;
        if (!a.enabled && b.enabled) return 1;
        if (a.isCore && !b.isCore) return -1;
        if (!a.isCore && b.isCore) return 1;
        return a.name.localeCompare(b.name);
      });
  }, [skills, searchQuery, selectedSource, typeFilter, pricingFilter, teamFilter]);

  const sourceStats = useMemo(
    () => ({
      all: skills.length,
      builtIn: skills.filter((s) => s.isBundled).length,
      marketplace: skills.filter((s) => !s.isBundled).length,
    }),
    [skills]
  );

  // Handle toggle
  const handleToggle = useCallback(
    async (skillId: string, enable: boolean) => {
      try {
        if (enable) {
          await enableSkill(skillId);
          toast.success(t('toast.enabled'));
        } else {
          await disableSkill(skillId);
          toast.success(t('toast.disabled'));
        }
      } catch (err) {
        toast.error(String(err));
      }
    },
    [enableSkill, disableSkill, t]
  );

  const hasInstalledSkills = skills.some((s) => !s.isBundled);

  const handleOpenSkillsFolder = useCallback(async () => {
    try {
      const skillsDir = (await window.electron.ipcRenderer.invoke(
        'openclaw:getSkillsDir'
      )) as string;
      if (!skillsDir) {
        throw new Error('Skills directory not available');
      }
      const result = (await window.electron.ipcRenderer.invoke(
        'shell:openPath',
        skillsDir
      )) as string;
      if (result) {
        if (
          result.toLowerCase().includes('no such file') ||
          result.toLowerCase().includes('not found') ||
          result.toLowerCase().includes('failed to open')
        ) {
          toast.error(t('toast.failedFolderNotFound'));
        } else {
          throw new Error(result);
        }
      }
    } catch (err) {
      toast.error(t('toast.failedOpenFolder') + ': ' + String(err));
    }
  }, [t]);

  // Handle marketplace search
  const handleMarketplaceSearch = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      searchSkills(marketplaceQuery);
    },
    [marketplaceQuery, searchSkills]
  );

  // Auto-reset when query is cleared
  useEffect(() => {
    if (
      activeTab === 'marketplace' &&
      marketplaceQuery === '' &&
      marketplaceDiscoveryAttemptedRef.current
    ) {
      searchSkills('');
    }
  }, [marketplaceQuery, activeTab, searchSkills]);

  // Handle install
  const handleInstall = useCallback(
    async (slug: string) => {
      try {
        await installSkill(slug);
        await enableSkill(slug);
        toast.success(t('toast.installed'));
      } catch (err) {
        toast.error(t('toast.failedInstall') + ': ' + String(err));
      }
    },
    [installSkill, enableSkill, t]
  );

  // Initial marketplace load (Discovery)
  useEffect(() => {
    if (activeTab !== 'marketplace') return;
    if (marketplaceQuery.trim()) return;
    if (searching) return;
    if (marketplaceDiscoveryAttemptedRef.current) return;
    marketplaceDiscoveryAttemptedRef.current = true;
    searchSkills('');
  }, [activeTab, marketplaceQuery, searching, searchSkills]);

  // Handle uninstall
  const handleUninstall = useCallback(
    async (slug: string) => {
      try {
        await uninstallSkill(slug);
        toast.success(t('toast.uninstalled'));
      } catch (err) {
        toast.error(t('toast.failedUninstall') + ': ' + String(err));
      }
    },
    [uninstallSkill, t]
  );

  // Check if any filters are active
  const hasActiveFilters = typeFilter !== 'all' || pricingFilter !== 'all' || teamFilter !== 'all';

  const clearFilters = () => {
    setTypeFilter('all');
    setPricingFilter('all');
    setTeamFilter('all');
    setSearchQuery('');
  };

  if (loading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-pixel text-xl font-bold tracking-wide">{tm('title')}</h1>
          <p className="text-xs text-muted-foreground mt-1">{tm('subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={fetchSkills} disabled={!isGatewayRunning}>
            <RefreshCw className="h-4 w-4 mr-2" />
            {t('refresh')}
          </Button>
          {hasInstalledSkills && (
            <Button variant="outline" onClick={handleOpenSkillsFolder}>
              <FolderOpen className="h-4 w-4 mr-2" />
              {t('openFolder')}
            </Button>
          )}
        </div>
      </div>

      {/* Gateway Warning */}
      {showGatewayWarning && (
        <Card className="border-yellow-500/30 bg-yellow-50 dark:bg-yellow-900/10 rounded-xl">
          <CardContent className="py-4 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-yellow-600" />
            <span className="text-yellow-700 dark:text-yellow-400">{t('gatewayWarning')}</span>
          </CardContent>
        </Card>
      )}

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="all" className="gap-2 rounded-xl">
            <Wrench className="h-4 w-4" />
            {t('tabs.installed')}
          </TabsTrigger>
          <TabsTrigger value="marketplace" className="gap-2 rounded-xl">
            <Globe className="h-4 w-4" />
            {t('tabs.marketplace')}
          </TabsTrigger>
        </TabsList>

        {/* ===================== INSTALLED TAB ===================== */}
        <TabsContent value="all" className="space-y-6 mt-6">
          {/* Search Bar */}
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={tm('search')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 pr-9"
            />
            {searchQuery && (
              <button
                type="button"
                className="absolute right-3 top-3 text-muted-foreground hover:text-foreground"
                onClick={() => setSearchQuery('')}
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {/* Filter Row */}
          <div className="flex gap-2 flex-wrap">
            {/* Source filters */}
            <Button
              variant={selectedSource === 'all' ? 'default' : 'outline'}
              size="sm"
              className="rounded-full"
              onClick={() => setSelectedSource('all')}
            >
              {tm('filters.all')} ({sourceStats.all})
            </Button>
            <Button
              variant={selectedSource === 'built-in' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setSelectedSource('built-in')}
              className="gap-2 rounded-full"
            >
              <Wrench className="h-3 w-3" />
              {t('filter.builtIn', { count: sourceStats.builtIn })}
            </Button>
            <Button
              variant={selectedSource === 'marketplace' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setSelectedSource('marketplace')}
              className="gap-2 rounded-full"
            >
              <Globe className="h-3 w-3" />
              {t('filter.marketplace', { count: sourceStats.marketplace })}
            </Button>

            {/* Separator */}
            <div className="w-px h-6 bg-border self-center mx-1" />

            {/* Type filters */}
            {(['knowledge', 'execution', 'hybrid'] as const).map((type) => (
              <Button
                key={type}
                variant={typeFilter === type ? 'default' : 'outline'}
                size="sm"
                className="rounded-full text-xs"
                onClick={() => setTypeFilter(typeFilter === type ? 'all' : type)}
              >
                {tm(`filters.${type}`)}
              </Button>
            ))}

            {/* Pricing filters */}
            {(['free', 'included', 'premium'] as const).map((tier) => (
              <Button
                key={tier}
                variant={pricingFilter === tier ? 'default' : 'outline'}
                size="sm"
                className="rounded-full text-xs"
                onClick={() => setPricingFilter(pricingFilter === tier ? 'all' : tier)}
              >
                {tm(`filters.${tier}`)}
              </Button>
            ))}

            {/* Team filters (dynamic) */}
            {availableTeams.map((team) => (
              <Button
                key={team}
                variant={teamFilter === team ? 'default' : 'outline'}
                size="sm"
                className="gap-1 rounded-full text-xs"
                onClick={() => setTeamFilter(teamFilter === team ? 'all' : team)}
              >
                <Users className="h-3 w-3" />
                {tm(`categories.${team}`, { defaultValue: team })}
              </Button>
            ))}

            {/* Clear filters */}
            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="sm"
                className="rounded-full text-xs text-muted-foreground"
                onClick={clearFilters}
              >
                <X className="h-3 w-3 mr-1" />
                {tm('filters.all')}
              </Button>
            )}
          </div>

          {/* Error Display */}
          {error && (
            <Card className="border-destructive/30 rounded-xl">
              <CardContent className="py-4 text-destructive flex items-center gap-2">
                <AlertCircle className="h-5 w-5" />
                {error}
              </CardContent>
            </Card>
          )}

          {/* Skills Grid */}
          {filteredSkills.length === 0 ? (
            <Card className="rounded-2xl glass-border shadow-island">
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Package className="h-12 w-12 text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium mb-2">{tm('empty.title')}</h3>
                <p className="text-muted-foreground text-center max-w-sm">
                  {searchQuery || hasActiveFilters
                    ? tm('empty.description')
                    : t('noSkillsAvailable')}
                </p>
                {hasActiveFilters && (
                  <Button variant="outline" size="sm" className="mt-4" onClick={clearFilters}>
                    {tm('filters.all')}
                  </Button>
                )}
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {filteredSkills.map((skill) => {
                const meta = deriveSkillMeta(skill);
                return (
                  <SkillCard
                    key={skill.id}
                    skill={skill}
                    skillType={meta.skillType}
                    team={meta.team}
                    pricingTier={meta.pricingTier}
                    rating={meta.rating}
                    onViewDetails={() => setSelectedSkill(skill)}
                    onUninstall={
                      !skill.isBundled && !skill.isCore
                        ? () => handleUninstall(skill.id)
                        : undefined
                    }
                    isInstalling={!!installing[skill.id]}
                  />
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* ===================== MARKETPLACE TAB ===================== */}
        <TabsContent value="marketplace" className="space-y-6 mt-6">
          <div className="flex flex-col gap-4">
            <Card className="border-muted/50 bg-muted/20 rounded-xl">
              <CardContent className="py-4 flex items-start gap-3">
                <ShieldCheck className="h-5 w-5 text-muted-foreground mt-0.5" />
                <div className="text-muted-foreground">{t('marketplace.securityNote')}</div>
              </CardContent>
            </Card>
            <div className="flex gap-4">
              <form onSubmit={handleMarketplaceSearch} className="flex-1 flex gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder={t('searchMarketplace')}
                    value={marketplaceQuery}
                    onChange={(e) => setMarketplaceQuery(e.target.value)}
                    className="pl-9 pr-9"
                  />
                  {marketplaceQuery && (
                    <button
                      type="button"
                      className="absolute right-3 top-3 text-muted-foreground hover:text-foreground"
                      onClick={() => setMarketplaceQuery('')}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
                <Button type="submit" disabled={searching} className="min-w-[100px]" asChild>
                  <motion.button whileTap={{ scale: 0.98 }}>
                    <AnimatePresence mode="wait" initial={false}>
                      {searching ? (
                        <motion.div
                          key="searching"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          className="flex items-center justify-center gap-1"
                        >
                          {[0, 1, 2].map((i) => (
                            <motion.span
                              key={i}
                              className="w-1.5 h-1.5 bg-current rounded-full"
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
                        </motion.div>
                      ) : (
                        <motion.div
                          key="search"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                        >
                          {t('searchButton')}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.button>
                </Button>
              </form>
            </div>

            {searchError && (
              <Card className="border-destructive/30 bg-destructive/5 rounded-xl">
                <CardContent className="py-3 text-sm text-destructive flex items-center gap-2">
                  <AlertCircle className="h-4 w-4" />
                  <span>{t('marketplace.searchError')}</span>
                </CardContent>
              </Card>
            )}

            {searchResults.length > 0 ? (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                {searchResults.map((skill) => {
                  const isInstalled = skills.some(
                    (s) => s.id === skill.slug || s.name === skill.name
                  );
                  return (
                    <MarketplaceSkillCard
                      key={skill.slug}
                      skill={skill}
                      isInstalling={!!installing[skill.slug]}
                      isInstalled={isInstalled}
                      onInstall={() => handleInstall(skill.slug)}
                      onUninstall={() => handleUninstall(skill.slug)}
                    />
                  );
                })}
              </div>
            ) : (
              <Card className="rounded-2xl glass-border shadow-island">
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <Package className="h-12 w-12 text-muted-foreground mb-4" />
                  <h3 className="text-lg font-medium mb-2">{t('marketplace.title')}</h3>
                  <p className="text-muted-foreground text-center max-w-sm">
                    {searching
                      ? t('marketplace.searching')
                      : marketplaceQuery
                        ? t('marketplace.noResults')
                        : t('marketplace.emptyPrompt')}
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>
      </Tabs>

      {/* Skill Detail Dialog */}
      {selectedSkill && (
        <SkillDetailDialog
          skill={selectedSkill}
          onClose={() => setSelectedSkill(null)}
          onToggle={(enabled) => {
            handleToggle(selectedSkill.id, enabled);
            setSelectedSkill({ ...selectedSkill, enabled });
          }}
        />
      )}
    </div>
  );
}

export default Skills;
