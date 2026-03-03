/**
 * MediaStudioSettings Component
 * Configuration panel for Media Studio image/video generation API keys, models, and endpoints.
 * Persisted via zustand settings store (localStorage).
 */
import { useState, useEffect } from 'react';
import { Eye, EyeOff, RotateCcw, Save, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { useSettingsStore, type MediaStudioConfig } from '@/stores/settings';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';

export function MediaStudioSettings() {
  const { t } = useTranslation('settings');
  const mediaStudio = useSettingsStore((s) => s.mediaStudio);
  const setMediaStudio = useSettingsStore((s) => s.setMediaStudio);
  const resetMediaStudio = useSettingsStore((s) => s.resetMediaStudio);

  // Local draft state so we can batch-save
  const [draft, setDraft] = useState<MediaStudioConfig>({ ...mediaStudio });
  const [showImageKey, setShowImageKey] = useState(false);
  const [showVideoKey, setShowVideoKey] = useState(false);
  const [saving, setSaving] = useState(false);

  // Sync draft when store changes externally (e.g. reset)
  useEffect(() => {
    setDraft({ ...mediaStudio });
  }, [mediaStudio]);

  const isDirty =
    draft.imageApiKey !== mediaStudio.imageApiKey ||
    draft.imageModel !== mediaStudio.imageModel ||
    draft.videoApiKey !== mediaStudio.videoApiKey ||
    draft.videoModel !== mediaStudio.videoModel ||
    draft.videoApiUrl !== mediaStudio.videoApiUrl;

  const handleSave = () => {
    setSaving(true);
    try {
      setMediaStudio(draft);
      toast.success(t('mediaStudio.saved'));
    } catch {
      toast.error(t('mediaStudio.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    resetMediaStudio();
    setShowImageKey(false);
    setShowVideoKey(false);
    toast.success(t('mediaStudio.resetDone'));
  };

  const updateDraft = (patch: Partial<MediaStudioConfig>) => {
    setDraft((prev) => ({ ...prev, ...patch }));
  };

  return (
    <div className="space-y-6">
      {/* Image Generation */}
      <div className="space-y-4">
        <div>
          <h4 className="text-sm font-medium">{t('mediaStudio.imageApi')}</h4>
          <p className="text-xs text-muted-foreground">{t('mediaStudio.imageApiDesc')}</p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2 space-y-2">
            <Label className="text-xs">{t('mediaStudio.apiKey')}</Label>
            <div className="relative">
              <Input
                type={showImageKey ? 'text' : 'password'}
                value={draft.imageApiKey}
                onChange={(e) => updateDraft({ imageApiKey: e.target.value })}
                placeholder={t('mediaStudio.apiKeyPlaceholder')}
                className="pr-10 font-mono text-sm"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-0 top-0 h-full w-10"
                onClick={() => setShowImageKey(!showImageKey)}
              >
                {showImageKey ? (
                  <EyeOff className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <Eye className="h-4 w-4 text-muted-foreground" />
                )}
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-xs">{t('mediaStudio.imageModel')}</Label>
            <Input
              value={draft.imageModel}
              onChange={(e) => updateDraft({ imageModel: e.target.value })}
              placeholder={t('mediaStudio.imageModelPlaceholder')}
              className="font-mono text-sm"
            />
          </div>
        </div>
      </div>

      <Separator />

      {/* Video Generation */}
      <div className="space-y-4">
        <div>
          <h4 className="text-sm font-medium">{t('mediaStudio.videoApi')}</h4>
          <p className="text-xs text-muted-foreground">{t('mediaStudio.videoApiDesc')}</p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2 space-y-2">
            <Label className="text-xs">{t('mediaStudio.apiKey')}</Label>
            <div className="relative">
              <Input
                type={showVideoKey ? 'text' : 'password'}
                value={draft.videoApiKey}
                onChange={(e) => updateDraft({ videoApiKey: e.target.value })}
                placeholder={t('mediaStudio.apiKeyPlaceholder')}
                className="pr-10 font-mono text-sm"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-0 top-0 h-full w-10"
                onClick={() => setShowVideoKey(!showVideoKey)}
              >
                {showVideoKey ? (
                  <EyeOff className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <Eye className="h-4 w-4 text-muted-foreground" />
                )}
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-xs">{t('mediaStudio.videoModel')}</Label>
            <Input
              value={draft.videoModel}
              onChange={(e) => updateDraft({ videoModel: e.target.value })}
              placeholder={t('mediaStudio.videoModelPlaceholder')}
              className="font-mono text-sm"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-xs">{t('mediaStudio.videoApiUrl')}</Label>
            <Input
              value={draft.videoApiUrl}
              onChange={(e) => updateDraft({ videoApiUrl: e.target.value })}
              placeholder={t('mediaStudio.videoApiUrlPlaceholder')}
              className="font-mono text-sm"
            />
          </div>
        </div>
      </div>

      {/* Info */}
      <p className="text-xs text-muted-foreground">{t('mediaStudio.apiKeyStored')}</p>

      {/* Actions */}
      <div className="flex items-center justify-end gap-2">
        <Button variant="outline" size="sm" onClick={handleReset}>
          <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
          {t('mediaStudio.reset')}
        </Button>
        <Button size="sm" onClick={handleSave} disabled={!isDirty || saving}>
          {saving ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Save className="mr-1.5 h-3.5 w-3.5" />
          )}
          {t('mediaStudio.save')}
        </Button>
      </div>
    </div>
  );
}
