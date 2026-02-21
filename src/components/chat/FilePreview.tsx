/**
 * FilePreview Component
 * Previews different file types (images, PDF, video, code, generic files)
 * with download/reveal-in-folder actions.
 */
import { useState, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  File,
  Image,
  FileText,
  Film,
  Code,
  FolderOpen,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// ── Types ──────────────────────────────────────────────────────────

interface FilePreviewProps {
  filePath: string;
  fileName?: string;
  className?: string;
}

type FileCategory = 'image' | 'pdf' | 'video' | 'code' | 'other';

// ── Extension maps ─────────────────────────────────────────────────

const IMAGE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico',
]);

const VIDEO_EXTENSIONS = new Set([
  '.mp4', '.webm', '.mov', '.avi', '.mkv',
]);

const CODE_EXTENSIONS = new Set([
  '.py', '.js', '.ts', '.tsx', '.jsx', '.json', '.md', '.txt', '.csv',
  '.html', '.css', '.scss', '.yaml', '.yml', '.toml', '.xml', '.sh',
  '.bash', '.sql', '.go', '.rs', '.java', '.rb', '.php', '.c', '.cpp',
  '.h', '.hpp', '.swift', '.kt',
]);

// ── Helpers ────────────────────────────────────────────────────────

function getExtension(filePath: string): string {
  const lastDot = filePath.lastIndexOf('.');
  if (lastDot === -1) return '';
  return filePath.slice(lastDot).toLowerCase();
}

function getFileName(filePath: string, overrideName?: string): string {
  if (overrideName) return overrideName;
  const parts = filePath.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || filePath;
}

function categorize(ext: string): FileCategory {
  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  if (ext === '.pdf') return 'pdf';
  if (VIDEO_EXTENSIONS.has(ext)) return 'video';
  if (CODE_EXTENSIONS.has(ext)) return 'code';
  return 'other';
}

function CategoryIcon({ category, className }: { category: FileCategory; className?: string }) {
  switch (category) {
    case 'image':
      return <Image className={className} />;
    case 'pdf':
      return <FileText className={className} />;
    case 'video':
      return <Film className={className} />;
    case 'code':
      return <Code className={className} />;
    default:
      return <File className={className} />;
  }
}

// ── Image lightbox ─────────────────────────────────────────────────

function ImageLightbox({
  src,
  alt,
  onClose,
}: {
  src: string;
  alt: string;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <button
        className="absolute right-4 top-4 rounded-full bg-background/20 p-2 text-white hover:bg-background/40 transition-colors"
        onClick={onClose}
      >
        <X className="h-5 w-5" />
      </button>
      <img
        src={src}
        alt={alt}
        className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────

export function FilePreview({ filePath, fileName, className }: FilePreviewProps) {
  const { t } = useTranslation('tasks');
  const [lightboxOpen, setLightboxOpen] = useState(false);

  const ext = useMemo(() => getExtension(filePath), [filePath]);
  const category = useMemo(() => categorize(ext), [ext]);
  const displayName = useMemo(() => getFileName(filePath, fileName), [filePath, fileName]);

  // Convert local file path to file:// URL for <img> and <video> tags
  const fileUrl = useMemo(() => {
    if (filePath.startsWith('file://') || filePath.startsWith('http')) return filePath;
    return `file://${filePath}`;
  }, [filePath]);

  const handleRevealInFolder = useCallback(() => {
    window.electron.ipcRenderer.invoke('shell:showItemInFolder', filePath);
  }, [filePath]);

  const handleOpenFile = useCallback(() => {
    window.electron.ipcRenderer.invoke('shell:openPath', filePath);
  }, [filePath]);

  // ── Image preview ──────────────────────────────────────────────

  if (category === 'image') {
    return (
      <>
        <div
          className={cn(
            'group/file relative overflow-hidden rounded-lg border bg-muted/30',
            'max-w-[300px] cursor-pointer transition-shadow hover:shadow-md',
            className
          )}
          onClick={() => setLightboxOpen(true)}
        >
          <img
            src={fileUrl}
            alt={displayName}
            className="h-auto max-h-[200px] w-full object-cover"
            loading="lazy"
          />
          <div className="absolute inset-0 flex items-end bg-gradient-to-t from-black/50 to-transparent opacity-0 transition-opacity group-hover/file:opacity-100">
            <div className="flex w-full items-center justify-between p-2">
              <span className="truncate text-xs text-white">{displayName}</span>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-white hover:bg-white/20"
                onClick={(e) => {
                  e.stopPropagation();
                  handleRevealInFolder();
                }}
                title={t('detail.openFile')}
              >
                <FolderOpen className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </div>
        {lightboxOpen && (
          <ImageLightbox
            src={fileUrl}
            alt={displayName}
            onClose={() => setLightboxOpen(false)}
          />
        )}
      </>
    );
  }

  // ── Video preview ──────────────────────────────────────────────

  if (category === 'video') {
    return (
      <div
        className={cn(
          'overflow-hidden rounded-lg border bg-muted/30 max-w-[400px]',
          className
        )}
      >
        <video
          src={fileUrl}
          controls
          preload="metadata"
          className="h-auto w-full"
        />
        <FileActionBar
          name={displayName}
          category={category}
          onReveal={handleRevealInFolder}
          onOpen={handleOpenFile}
          openLabel={t('detail.openFile')}
        />
      </div>
    );
  }

  // ── PDF / Code / Other → card layout ───────────────────────────

  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-lg border bg-muted/30 p-3 max-w-[320px]',
        'transition-colors hover:bg-muted/50',
        className
      )}
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted">
        <CategoryIcon category={category} className="h-5 w-5 text-muted-foreground" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{displayName}</p>
        <p className="text-xs text-muted-foreground uppercase">{ext.replace('.', '') || 'file'}</p>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 shrink-0"
        onClick={handleRevealInFolder}
        title={t('detail.openFile')}
      >
        <FolderOpen className="h-4 w-4" />
      </Button>
    </div>
  );
}

// ── File action bar (used inside video card) ───────────────────────

function FileActionBar({
  name,
  category,
  onReveal,
  onOpen,
  openLabel,
}: {
  name: string;
  category: FileCategory;
  onReveal: () => void;
  onOpen: () => void;
  openLabel: string;
}) {
  return (
    <div className="flex items-center gap-2 border-t px-3 py-2">
      <CategoryIcon category={category} className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate text-xs font-medium">{name}</span>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 gap-1.5 text-xs"
        onClick={onOpen}
      >
        {openLabel}
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        onClick={onReveal}
        title={openLabel}
      >
        <FolderOpen className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
