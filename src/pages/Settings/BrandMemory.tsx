/**
 * Brand Memory Settings
 * Markdown editor for BRAND.md — shared business context injected
 * into all AI employee system prompts.
 */
import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Building2, Save } from 'lucide-react';
import { toast } from 'sonner';

export function BrandMemory() {
  const { t } = useTranslation('settings');

  const [markdown, setMarkdown] = useState('');
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const loadBrand = useCallback(async () => {
    try {
      const result = (await window.electron.ipcRenderer.invoke('memory:getBrand')) as {
        success: boolean;
        result?: string;
        error?: string;
      };
      if (result.success) {
        setMarkdown(result.result ?? '');
      }
    } catch {
      // Non-fatal
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    loadBrand();
  }, [loadBrand]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const result = (await window.electron.ipcRenderer.invoke(
        'memory:setBrand',
        markdown
      )) as { success: boolean; error?: string };
      if (result.success) {
        toast.success(t('brandMemory.saved'));
      } else {
        toast.error(result.error ?? 'Failed to save');
      }
    } catch {
      toast.error('Failed to save brand context');
    } finally {
      setSaving(false);
    }
  };

  if (!loaded) return null;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            {t('brandMemory.title')}
          </CardTitle>
          <p className="text-sm text-muted-foreground">{t('brandMemory.description')}</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <Textarea
            value={markdown}
            onChange={(e) => setMarkdown(e.target.value)}
            placeholder={t('brandMemory.placeholder')}
            rows={20}
            className="font-mono text-sm"
          />
          <div className="flex justify-end">
            <Button onClick={handleSave} disabled={saving} size="sm">
              <Save className="h-4 w-4 mr-2" />
              {t('brandMemory.save')}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
