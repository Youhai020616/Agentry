/**
 * Prohibitions Settings
 * Management UI for AI employee rules & restrictions.
 */
import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Select } from '@/components/ui/native-select';
import { Separator } from '@/components/ui/separator';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Plus, Pencil, Trash2, ShieldAlert, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';

interface Prohibition {
  id: string;
  level: 'hard' | 'soft';
  rule: string;
  description: string;
  employeeId?: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

async function fetchProhibitions(): Promise<Prohibition[]> {
  try {
    const result = (await window.electron.ipcRenderer.invoke('prohibition:list')) as {
      success: boolean;
      result?: Prohibition[];
      error?: string;
    };
    return result.success ? result.result ?? [] : [];
  } catch {
    return [];
  }
}

export function Prohibitions() {
  const { t } = useTranslation('settings');
  const [prohibitions, setProhibitions] = useState<Prohibition[]>([]);
  const [loading, setLoading] = useState(true);

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formLevel, setFormLevel] = useState<'hard' | 'soft'>('hard');
  const [formRule, setFormRule] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [saving, setSaving] = useState(false);

  // Delete confirmation
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    const data = await fetchProhibitions();
    setProhibitions(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const openCreateDialog = () => {
    setEditingId(null);
    setFormLevel('hard');
    setFormRule('');
    setFormDescription('');
    setDialogOpen(true);
  };

  const openEditDialog = (p: Prohibition) => {
    setEditingId(p.id);
    setFormLevel(p.level);
    setFormRule(p.rule);
    setFormDescription(p.description);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!formRule.trim()) return;
    setSaving(true);
    try {
      if (editingId) {
        const result = (await window.electron.ipcRenderer.invoke('prohibition:update', editingId, {
          level: formLevel,
          rule: formRule.trim(),
          description: formDescription.trim(),
        })) as { success: boolean; error?: string };
        if (result.success) {
          toast.success(t('prohibitions.updated'));
        } else {
          toast.error(result.error ?? 'Failed to update');
        }
      } else {
        const result = (await window.electron.ipcRenderer.invoke('prohibition:create', {
          level: formLevel,
          rule: formRule.trim(),
          description: formDescription.trim(),
        })) as { success: boolean; error?: string };
        if (result.success) {
          toast.success(t('prohibitions.created'));
        } else {
          toast.error(result.error ?? 'Failed to create');
        }
      }
      setDialogOpen(false);
      await loadData();
    } catch (error) {
      toast.error(String(error));
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (id: string, enabled: boolean) => {
    try {
      await window.electron.ipcRenderer.invoke('prohibition:toggle', id, enabled);
      setProhibitions((prev) => prev.map((p) => (p.id === id ? { ...p, enabled } : p)));
    } catch (error) {
      toast.error(String(error));
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      const result = (await window.electron.ipcRenderer.invoke(
        'prohibition:delete',
        deleteId
      )) as { success: boolean; error?: string };
      if (result.success) {
        toast.success(t('prohibitions.deleted'));
        await loadData();
      } else {
        toast.error(result.error ?? 'Failed to delete');
      }
    } catch (error) {
      toast.error(String(error));
    } finally {
      setDeleteId(null);
    }
  };

  const hardRules = prohibitions.filter((p) => p.level === 'hard');
  const softRules = prohibitions.filter((p) => p.level === 'soft');

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <p className="text-sm text-muted-foreground">{t('common:status.loading')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{t('prohibitions.description')}</p>
        <Button size="sm" onClick={openCreateDialog}>
          <Plus className="h-4 w-4 mr-2" />
          {t('prohibitions.add')}
        </Button>
      </div>

      {prohibitions.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-sm text-muted-foreground">{t('prohibitions.noRules')}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Hard Rules */}
          {hardRules.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <ShieldAlert className="h-4 w-4 text-destructive" />
                <h4 className="text-sm font-semibold">{t('prohibitions.hard')}</h4>
                <span className="text-xs text-muted-foreground">
                  {t('prohibitions.hardDescription')}
                </span>
              </div>
              {hardRules.map((p) => (
                <ProhibitionCard
                  key={p.id}
                  prohibition={p}
                  t={t}
                  onEdit={() => openEditDialog(p)}
                  onDelete={() => setDeleteId(p.id)}
                  onToggle={(enabled) => handleToggle(p.id, enabled)}
                />
              ))}
            </div>
          )}

          {hardRules.length > 0 && softRules.length > 0 && <Separator />}

          {/* Soft Rules */}
          {softRules.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-yellow-500" />
                <h4 className="text-sm font-semibold">{t('prohibitions.soft')}</h4>
                <span className="text-xs text-muted-foreground">
                  {t('prohibitions.softDescription')}
                </span>
              </div>
              {softRules.map((p) => (
                <ProhibitionCard
                  key={p.id}
                  prohibition={p}
                  t={t}
                  onEdit={() => openEditDialog(p)}
                  onDelete={() => setDeleteId(p.id)}
                  onToggle={(enabled) => handleToggle(p.id, enabled)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingId ? t('prohibitions.edit') : t('prohibitions.add')}
            </DialogTitle>
            <DialogDescription>{t('prohibitions.description')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>{t('prohibitions.level')}</Label>
              <Select
                value={formLevel}
                onChange={(e) => setFormLevel(e.target.value as 'hard' | 'soft')}
              >
                <option value="hard">{t('prohibitions.hard')}</option>
                <option value="soft">{t('prohibitions.soft')}</option>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t('prohibitions.rule')}</Label>
              <Input
                value={formRule}
                onChange={(e) => setFormRule(e.target.value)}
                placeholder="Never do X without Y..."
              />
            </div>
            <div className="space-y-2">
              <Label>{t('prohibitions.ruleDescription')}</Label>
              <Textarea
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                placeholder="Why this rule exists..."
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              {t('common:actions.cancel')}
            </Button>
            <Button onClick={handleSave} disabled={saving || !formRule.trim()}>
              {editingId ? t('common:actions.save') : t('prohibitions.add')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('prohibitions.delete')}</DialogTitle>
            <DialogDescription>{t('prohibitions.deleteConfirm')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteId(null)}>
              {t('common:actions.cancel')}
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              {t('prohibitions.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Sub-component ────────────────────────────────────────────────────

function ProhibitionCard({
  prohibition,
  t,
  onEdit,
  onDelete,
  onToggle,
}: {
  prohibition: Prohibition;
  t: (key: string) => string;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: (enabled: boolean) => void;
}) {
  return (
    <Card className={prohibition.enabled ? '' : 'opacity-50'}>
      <CardContent className="flex items-start gap-3 py-3 px-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Badge
              variant={prohibition.level === 'hard' ? 'destructive' : 'outline'}
              className="text-xs"
            >
              {prohibition.level === 'hard' ? t('prohibitions.hard') : t('prohibitions.soft')}
            </Badge>
            {prohibition.employeeId && (
              <Badge variant="secondary" className="text-xs">
                {prohibition.employeeId}
              </Badge>
            )}
          </div>
          <p className="text-sm font-medium">{prohibition.rule}</p>
          {prohibition.description && (
            <p className="text-xs text-muted-foreground mt-0.5">{prohibition.description}</p>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Switch
            checked={prohibition.enabled}
            onCheckedChange={onToggle}
            aria-label={t('prohibitions.enabled')}
          />
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onEdit}>
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onDelete}>
            <Trash2 className="h-3.5 w-3.5 text-destructive" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
