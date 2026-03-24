/**
 * Chat Input Component
 * Glassmorphism design inspired by better-chatbot:
 *   - 4-layer glass effect (blur → tint → highlight → content)
 *   - rounded-4xl pill shape
 *   - Toolbar: attach + thinking toggle (left), send/stop (right)
 *   - Attachment previews inside the glass container
 *
 * Enter to send, Shift+Enter for new line.
 * Supports: native file picker, clipboard paste, drag & drop.
 */
import { useState, useRef, useCallback, useEffect } from 'react';
import {
  CornerRightUp,
  Square,
  X,
  Paperclip,
  LightbulbIcon,
  ImageIcon,
  FileText,
  Film,
  Music,
  FileArchive,
  File,
  Loader2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { useChatStore } from '@/stores/chat';
import { GlassFilter } from '@/components/ui/liquid-glass';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

// ── Types ────────────────────────────────────────────────────────

export interface FileAttachment {
  id: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  stagedPath: string; // disk path for gateway
  preview: string | null; // data URL for images, null for others
  status: 'staging' | 'ready' | 'error';
  error?: string;
}

interface ChatInputProps {
  onSend: (text: string, attachments?: FileAttachment[]) => void;
  onStop?: () => void;
  disabled?: boolean;
  sending?: boolean;
}

// ── Helpers ──────────────────────────────────────────────────────

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function FileIcon({ mimeType, className }: { mimeType: string; className?: string }) {
  if (mimeType.startsWith('video/')) return <Film className={className} />;
  if (mimeType.startsWith('audio/')) return <Music className={className} />;
  if (
    mimeType.startsWith('text/') ||
    mimeType === 'application/json' ||
    mimeType === 'application/xml'
  )
    return <FileText className={className} />;
  if (
    mimeType.includes('zip') ||
    mimeType.includes('compressed') ||
    mimeType.includes('archive') ||
    mimeType.includes('tar') ||
    mimeType.includes('rar') ||
    mimeType.includes('7z')
  )
    return <FileArchive className={className} />;
  if (mimeType === 'application/pdf') return <FileText className={className} />;
  return <File className={className} />;
}

/**
 * Read a browser File object as base64 string (without the data URL prefix).
 */
function readFileAsBase64(file: globalThis.File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      if (!dataUrl || !dataUrl.includes(',')) {
        reject(new Error(`Invalid data URL from FileReader for ${file.name}`));
        return;
      }
      const base64 = dataUrl.split(',')[1];
      if (!base64) {
        reject(new Error(`Empty base64 data for ${file.name}`));
        return;
      }
      resolve(base64);
    };
    reader.onerror = () => reject(new Error(`Failed to read file: ${file.name}`));
    reader.readAsDataURL(file);
  });
}

// ── Auto-resize hook ─────────────────────────────────────────────

function useAutoResizeTextarea(minHeight: number, maxHeight: number) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const adjustHeight = useCallback(
    (reset?: boolean) => {
      const textarea = textareaRef.current;
      if (!textarea) return;

      if (reset) {
        textarea.style.height = `${minHeight}px`;
        return;
      }

      textarea.style.height = `${minHeight}px`;
      const newHeight = Math.max(minHeight, Math.min(textarea.scrollHeight, maxHeight));
      textarea.style.height = `${newHeight}px`;
    },
    [minHeight, maxHeight]
  );

  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = `${minHeight}px`;
    }
  }, [minHeight]);

  useEffect(() => {
    const handleResize = () => adjustHeight();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [adjustHeight]);

  return { textareaRef, adjustHeight };
}

// ── Component ────────────────────────────────────────────────────

export function ChatInput({ onSend, onStop, disabled = false, sending = false }: ChatInputProps) {
  const { t } = useTranslation('chat');
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<FileAttachment[]>([]);
  const isComposingRef = useRef(false);
  const { textareaRef, adjustHeight } = useAutoResizeTextarea(36, 200);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Thinking toggle from store
  const showThinking = useChatStore((s) => s.showThinking);
  const toggleThinking = useChatStore((s) => s.toggleThinking);

  // ── File staging via native dialog ─────────────────────────────

  const pickFiles = useCallback(async () => {
    try {
      const result = (await window.electron.ipcRenderer.invoke('dialog:open', {
        properties: ['openFile', 'multiSelections'],
      })) as { canceled: boolean; filePaths?: string[] };
      if (result.canceled || !result.filePaths?.length) return;

      const tempIds: string[] = [];
      for (const filePath of result.filePaths) {
        const tempId = crypto.randomUUID();
        tempIds.push(tempId);
        const fileName = filePath.split(/[\\/]/).pop() || 'file';
        setAttachments((prev) => [
          ...prev,
          {
            id: tempId,
            fileName,
            mimeType: '',
            fileSize: 0,
            stagedPath: '',
            preview: null,
            status: 'staging' as const,
          },
        ]);
      }

      const staged = (await window.electron.ipcRenderer.invoke(
        'file:stage',
        result.filePaths
      )) as Array<{
        id: string;
        fileName: string;
        mimeType: string;
        fileSize: number;
        stagedPath: string;
        preview: string | null;
      }>;
      setAttachments((prev) => {
        let updated = [...prev];
        for (let i = 0; i < tempIds.length; i++) {
          const tempId = tempIds[i];
          const data = staged[i];
          if (data) {
            updated = updated.map((a) =>
              a.id === tempId ? { ...data, status: 'ready' as const } : a
            );
          } else {
            console.warn(`[pickFiles] No staged data for tempId=${tempId} at index ${i}`);
            updated = updated.map((a) =>
              a.id === tempId ? { ...a, status: 'error' as const, error: 'Staging failed' } : a
            );
          }
        }
        return updated;
      });
    } catch (err) {
      console.error('[pickFiles] Failed to stage files:', err);
      setAttachments((prev) =>
        prev.map((a) =>
          a.status === 'staging' ? { ...a, status: 'error' as const, error: String(err) } : a
        )
      );
    }
  }, []);

  // ── Stage browser File objects (paste / drag-drop) ─────────────

  const stageBufferFiles = useCallback(async (files: globalThis.File[]) => {
    for (const file of files) {
      const tempId = crypto.randomUUID();
      setAttachments((prev) => [
        ...prev,
        {
          id: tempId,
          fileName: file.name,
          mimeType: file.type || 'application/octet-stream',
          fileSize: file.size,
          stagedPath: '',
          preview: null,
          status: 'staging' as const,
        },
      ]);

      try {
        const base64 = await readFileAsBase64(file);
        const staged = (await window.electron.ipcRenderer.invoke('file:stageBuffer', {
          base64,
          fileName: file.name,
          mimeType: file.type || 'application/octet-stream',
        })) as {
          id: string;
          fileName: string;
          mimeType: string;
          fileSize: number;
          stagedPath: string;
          preview: string | null;
        };
        setAttachments((prev) =>
          prev.map((a) => (a.id === tempId ? { ...staged, status: 'ready' as const } : a))
        );
      } catch (err) {
        console.error(`[stageBuffer] Error staging ${file.name}:`, err);
        setAttachments((prev) =>
          prev.map((a) =>
            a.id === tempId ? { ...a, status: 'error' as const, error: String(err) } : a
          )
        );
      }
    }
  }, []);

  // ── Attachment management ──────────────────────────────────────

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const allReady = attachments.length === 0 || attachments.every((a) => a.status === 'ready');
  const canSend = (input.trim() || attachments.length > 0) && allReady && !disabled && !sending;
  const canStop = sending && !disabled && !!onStop;

  const handleSend = useCallback(() => {
    if (!canSend) return;
    const readyAttachments = attachments.filter((a) => a.status === 'ready');
    const textToSend = input.trim();
    const attachmentsToSend = readyAttachments.length > 0 ? readyAttachments : undefined;
    setInput('');
    setAttachments([]);
    adjustHeight(true);
    onSend(textToSend, attachmentsToSend);
  }, [input, attachments, canSend, onSend, adjustHeight]);

  const handleStop = useCallback(() => {
    if (!canStop) return;
    onStop?.();
  }, [canStop, onStop]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        const nativeEvent = e.nativeEvent as KeyboardEvent;
        if (isComposingRef.current || nativeEvent.isComposing || nativeEvent.keyCode === 229) {
          return;
        }
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  // Handle paste (Ctrl/Cmd+V with files)
  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      const pastedFiles: globalThis.File[] = [];
      for (const item of Array.from(items)) {
        if (item.kind === 'file') {
          const file = item.getAsFile();
          if (file) pastedFiles.push(file);
        }
      }
      if (pastedFiles.length > 0) {
        e.preventDefault();
        stageBufferFiles(pastedFiles);
      }
    },
    [stageBufferFiles]
  );

  // Handle drag & drop
  const [dragOver, setDragOver] = useState(false);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOver(false);
      if (e.dataTransfer?.files?.length) {
        stageBufferFiles(Array.from(e.dataTransfer.files));
      }
    },
    [stageBufferFiles]
  );

  // Handle image file select from hidden input
  const handleImageSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files || files.length === 0) return;
      stageBufferFiles(Array.from(files));
      // Reset so the same file can be selected again
      if (fileInputRef.current) fileInputRef.current.value = '';
    },
    [stageBufferFiles]
  );

  return (
    <div
      className="px-4 pt-2 pb-6"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* SVG filter definition — must be in DOM for url(#glass-distortion) to work */}
      <GlassFilter />

      <div className="max-w-4xl mx-auto">
        <fieldset className="flex w-full min-w-0 max-w-full flex-col">
          <div
            className={cn(
              'relative overflow-hidden rounded-4xl transition-all duration-200 flex w-full flex-col cursor-text z-10 items-stretch',
              dragOver && 'ring-2 ring-primary'
            )}
            style={{
              boxShadow: '0 6px 6px rgba(0, 0, 0, 0.15), 0 0 20px rgba(0, 0, 0, 0.08)',
            }}
          >
            {/* Layer 1: Glass distortion — blur + SVG optical filter */}
            <div
              className="absolute inset-0 z-0 overflow-hidden rounded-4xl"
              style={{
                backdropFilter: 'blur(12px)',
                WebkitBackdropFilter: 'blur(12px)',
                filter: 'url(#glass-distortion)',
                isolation: 'isolate',
              }}
            />
            {/* Layer 2: Glass tint */}
            <div className="absolute inset-0 z-[1] rounded-4xl bg-muted/60 transition-all duration-200" />
            {/* Layer 3: Inner highlight (edge refraction) */}
            <div
              className="absolute inset-0 z-[2] rounded-4xl overflow-hidden pointer-events-none"
              style={{
                boxShadow:
                  'inset 1px 1px 1px 0 rgba(255, 255, 255, 0.3), inset -1px -1px 1px 0 rgba(255, 255, 255, 0.2)',
              }}
            />
            {/* Layer 4: Content */}
            <div className="relative z-[3] flex w-full flex-col items-stretch focus-within:bg-muted/40 hover:bg-muted/40 rounded-4xl transition-all duration-200">
              {/* Attachment Previews */}
              {attachments.length > 0 && (
                <div className="bg-input rounded-b-sm rounded-t-3xl p-3 flex flex-wrap gap-2 mx-2 my-2">
                  {attachments.map((att) => (
                    <AttachmentPreview
                      key={att.id}
                      attachment={att}
                      onRemove={() => removeAttachment(att.id)}
                    />
                  ))}
                </div>
              )}

              {/* Textarea + Toolbar */}
              <div className="flex flex-col gap-1.5 px-5 pt-2 pb-2.5">
                {/* Textarea — auto-resize, borderless */}
                <div className="relative min-h-[2rem] overflow-hidden">
                  <textarea
                    ref={textareaRef}
                    value={input}
                    onChange={(e) => {
                      setInput(e.target.value);
                      adjustHeight();
                    }}
                    onKeyDown={handleKeyDown}
                    onCompositionStart={() => {
                      isComposingRef.current = true;
                    }}
                    onCompositionEnd={() => {
                      isComposingRef.current = false;
                    }}
                    onPaste={handlePaste}
                    placeholder={disabled ? 'Gateway not connected...' : 'Ask anything...'}
                    disabled={disabled}
                    className={cn(
                      'w-full resize-none border-0 bg-transparent text-sm leading-relaxed outline-none',
                      'text-foreground placeholder:text-muted-foreground/50',
                      'focus:ring-0 focus-visible:outline-none min-h-[2rem] no-scrollbar',
                      'disabled:cursor-not-allowed disabled:opacity-50'
                    )}
                    rows={1}
                  />
                </div>

                {/* Bottom toolbar — matches better-chatbot layout */}
                <div className="flex w-full items-center z-30">
                  {/* Hidden file input for image upload */}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleImageSelect}
                    multiple
                  />

                  {/* Image upload button */}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={disabled || sending}
                        className={cn(
                          'rounded-full p-2 transition-colors',
                          'text-muted-foreground',
                          'hover:bg-muted/40 hover:text-foreground',
                          'disabled:pointer-events-none disabled:opacity-30'
                        )}
                      >
                        <ImageIcon className="size-4" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top">{t('input.uploadImage')}</TooltipContent>
                  </Tooltip>

                  {/* Thinking toggle */}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={() => {
                          toggleThinking();
                          textareaRef.current?.focus();
                        }}
                        className={cn(
                          'rounded-full p-2 transition-colors',
                          'text-muted-foreground',
                          'hover:bg-muted/40',
                          showThinking && 'bg-muted/40 text-yellow-500'
                        )}
                      >
                        <LightbulbIcon
                          className={cn(
                            'size-4 transition-colors duration-200',
                            showThinking && 'text-yellow-500 fill-yellow-500'
                          )}
                        />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent className="flex items-center gap-2" side="top">
                      <span>{t('input.thinking')}</span>
                      <kbd className="pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
                        <span className="text-xs">
                          {navigator.platform.includes('Mac') ? '\u2318' : 'Ctrl'}
                        </span>
                        E
                      </kbd>
                    </TooltipContent>
                  </Tooltip>

                  {/* Attach files (native dialog) */}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={pickFiles}
                        disabled={disabled || sending}
                        className={cn(
                          'rounded-full p-2 transition-colors',
                          'text-muted-foreground',
                          'hover:bg-muted/40 hover:text-foreground',
                          'disabled:pointer-events-none disabled:opacity-30'
                        )}
                      >
                        <Paperclip className="size-4" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top">{t('input.attachFiles')}</TooltipContent>
                  </Tooltip>

                  {/* Spacer */}
                  <div className="flex-1" />

                  {/* Send / Stop button */}
                  {sending ? (
                    <button
                      type="button"
                      onClick={handleStop}
                      disabled={!canStop}
                      className={cn(
                        'rounded-full p-2 transition-all duration-200 cursor-pointer',
                        'bg-destructive text-destructive-foreground',
                        'hover:bg-destructive/90',
                        'disabled:opacity-50 disabled:pointer-events-none'
                      )}
                    >
                      <Square className="size-4" fill="currentColor" />
                    </button>
                  ) : (
                    <div
                      onClick={handleSend}
                      className={cn(
                        'cursor-pointer rounded-full p-2 transition-all duration-200',
                        'text-muted-foreground bg-secondary',
                        'hover:bg-accent-foreground hover:text-accent',
                        !canSend && 'opacity-30 pointer-events-none'
                      )}
                    >
                      <CornerRightUp className="size-4" />
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </fieldset>
      </div>
    </div>
  );
}

// ── Attachment Preview ───────────────────────────────────────────

function AttachmentPreview({
  attachment,
  onRemove,
}: {
  attachment: FileAttachment;
  onRemove: () => void;
}) {
  const isImage = attachment.mimeType.startsWith('image/') && attachment.preview;

  return (
    <div className="relative group rounded-lg overflow-hidden border border-border">
      {isImage ? (
        <img
          src={attachment.preview!}
          alt={attachment.fileName}
          className="h-20 w-20 object-cover"
        />
      ) : (
        <div className="flex items-center gap-2 px-3 py-2 max-w-[200px]">
          <FileIcon
            mimeType={attachment.mimeType}
            className="h-4 w-4 shrink-0 text-muted-foreground"
          />
          <div className="min-w-0 overflow-hidden">
            <p className="text-xs font-medium truncate">{attachment.fileName}</p>
            <p className="text-[10px] text-muted-foreground">
              {attachment.fileSize > 0 ? formatFileSize(attachment.fileSize) : '...'}
            </p>
          </div>
        </div>
      )}

      {/* Staging overlay */}
      {attachment.status === 'staging' && (
        <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
          <Loader2 className="h-4 w-4 text-white animate-spin" />
        </div>
      )}

      {/* Error overlay */}
      {attachment.status === 'error' && (
        <div className="absolute inset-0 bg-destructive/20 flex items-center justify-center">
          <span className="text-[10px] text-destructive font-medium px-1">Error</span>
        </div>
      )}

      {/* Remove button — ghost circle on hover */}
      <button
        onClick={onRemove}
        className="absolute top-1 right-1 size-6 rounded-full bg-background/80 hover:bg-background flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <X className="size-3" />
      </button>
    </div>
  );
}
