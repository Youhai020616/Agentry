/**
 * Local Models Settings Component
 * Ollama integration: status, model list, pull, delete
 */
import { useEffect, useState, useCallback, useRef } from 'react';
import {
  HardDrive,
  Download,
  Trash2,
  RefreshCw,
  CheckCircle2,
  XCircle,
  ExternalLink,
  Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';

interface OllamaModel {
  name: string;
  size: number;
  digest: string;
  modified_at: string;
  details?: {
    format?: string;
    family?: string;
    parameter_size?: string;
    quantization_level?: string;
  };
}

interface OllamaStatus {
  installed: boolean;
  running: boolean;
  models: OllamaModel[];
}

interface PullProgress {
  name: string;
  status: string;
  digest?: string;
  total?: number;
  completed?: number;
}

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

export function LocalModels() {
  const { t } = useTranslation('settings');
  const [status, setStatus] = useState<OllamaStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [pullName, setPullName] = useState('');
  const [pulling, setPulling] = useState(false);
  const [pullProgress, setPullProgress] = useState<PullProgress | null>(null);
  const [deletingModel, setDeletingModel] = useState<string | null>(null);
  const unsubRef = useRef<(() => void) | null>(null);

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    try {
      const result = (await window.electron.ipcRenderer.invoke('ollama:status')) as {
        success: boolean;
        result?: OllamaStatus;
        error?: string;
      };
      if (result.success && result.result) {
        setStatus(result.result);
      } else {
        setStatus({ installed: false, running: false, models: [] });
      }
    } catch {
      setStatus({ installed: false, running: false, models: [] });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // Listen for pull progress events
  useEffect(() => {
    const unsub = window.electron.ipcRenderer.on(
      'ollama:pull-progress',
      (...args: unknown[]) => {
        const progress = args[0] as PullProgress;
        setPullProgress(progress);
      }
    );
    unsubRef.current = unsub as (() => void) | null;
    return () => {
      if (unsubRef.current) {
        unsubRef.current();
      }
    };
  }, []);

  const handlePull = async () => {
    const name = pullName.trim();
    if (!name) return;

    setPulling(true);
    setPullProgress(null);
    try {
      const result = (await window.electron.ipcRenderer.invoke('ollama:pullModel', name)) as {
        success: boolean;
        error?: string;
      };
      if (result.success) {
        toast.success(t('ollama.pullSuccess', { name }));
        setPullName('');
        // Refresh model list
        await fetchStatus();
      } else {
        toast.error(result.error || t('ollama.pullFailed'));
      }
    } catch (error) {
      toast.error(String(error));
    } finally {
      setPulling(false);
      setPullProgress(null);
    }
  };

  const handleDelete = async (name: string) => {
    setDeletingModel(name);
    try {
      const result = (await window.electron.ipcRenderer.invoke('ollama:deleteModel', name)) as {
        success: boolean;
        error?: string;
      };
      if (result.success) {
        toast.success(t('ollama.deleteSuccess', { name }));
        await fetchStatus();
      } else {
        toast.error(result.error || t('ollama.deleteFailed'));
      }
    } catch (error) {
      toast.error(String(error));
    } finally {
      setDeletingModel(null);
    }
  };

  const pullPercent =
    pullProgress?.total && pullProgress?.completed
      ? Math.round((pullProgress.completed / pullProgress.total) * 100)
      : 0;

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t('ollama.checking')}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Status indicators */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            {status?.installed ? (
              <CheckCircle2 className="h-4 w-4 text-green-500" />
            ) : (
              <XCircle className="h-4 w-4 text-red-500" />
            )}
            <span className="text-sm">
              {status?.installed ? t('ollama.installed') : t('ollama.notInstalled')}
            </span>
          </div>
          {status?.installed && (
            <div className="flex items-center gap-2">
              {status.running ? (
                <CheckCircle2 className="h-4 w-4 text-green-500" />
              ) : (
                <XCircle className="h-4 w-4 text-yellow-500" />
              )}
              <span className="text-sm">
                {status.running ? t('ollama.running') : t('ollama.stopped')}
              </span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={fetchStatus}>
            <RefreshCw className="h-4 w-4" />
          </Button>
          {!status?.installed && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.electron.openExternal('https://ollama.com')}
            >
              <ExternalLink className="h-3 w-3 mr-2" />
              {t('ollama.install')}
            </Button>
          )}
        </div>
      </div>

      {/* Pull new model */}
      {status?.installed && status.running && (
        <>
          <Separator />
          <div className="space-y-2">
            <Label>{t('ollama.pullModel')}</Label>
            <div className="flex gap-2">
              <Input
                value={pullName}
                onChange={(e) => setPullName(e.target.value)}
                placeholder={t('ollama.pullPlaceholder')}
                disabled={pulling}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handlePull();
                }}
              />
              <Button onClick={handlePull} disabled={pulling || !pullName.trim()}>
                {pulling ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Download className="h-4 w-4 mr-2" />
                )}
                {t('ollama.pull')}
              </Button>
            </div>
            {pulling && pullProgress && (
              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{pullProgress.status}</span>
                  {pullProgress.total ? <span>{pullPercent}%</span> : null}
                </div>
                {pullProgress.total ? <Progress value={pullPercent} className="h-2" /> : null}
              </div>
            )}
          </div>
        </>
      )}

      {/* Installed models list */}
      {status?.models && status.models.length > 0 && (
        <>
          <Separator />
          <div className="space-y-2">
            <Label>
              {t('ollama.installedModels')} ({status.models.length})
            </Label>
            <div className="space-y-2">
              {status.models.map((model) => (
                <div
                  key={model.digest}
                  className="flex items-center justify-between rounded-lg border p-3"
                >
                  <div className="flex items-center gap-3">
                    <HardDrive className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium">{model.name}</p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span>{formatSize(model.size)}</span>
                        {model.details?.parameter_size && (
                          <Badge variant="secondary" className="text-xs py-0">
                            {model.details.parameter_size}
                          </Badge>
                        )}
                        {model.details?.quantization_level && (
                          <Badge variant="outline" className="text-xs py-0">
                            {model.details.quantization_level}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDelete(model.name)}
                    disabled={deletingModel === model.name}
                  >
                    {deletingModel === model.name ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4 text-destructive" />
                    )}
                  </Button>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Empty state */}
      {status?.installed && status.running && status.models.length === 0 && (
        <p className="text-sm text-muted-foreground">{t('ollama.noModels')}</p>
      )}
    </div>
  );
}
