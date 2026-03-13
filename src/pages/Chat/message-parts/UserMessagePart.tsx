/**
 * User Message Part
 * Renders user text bubble with long-text truncation, inline edit mode,
 * and hover action buttons (copy / edit / delete).
 */
import { useState, useCallback, useRef, useEffect, memo } from 'react';
import { Copy, Check, Pencil, Trash2, ChevronDown, ChevronUp, User, File } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import type { RawMessage, AttachedFileMeta } from '@/stores/chat';
import { extractText, extractImages, formatTimestamp } from '../message-utils';

const MAX_TEXT_LENGTH = 1000;

// ── File helpers (moved from ChatMessage) ───────────────────────

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function FileIcon({ className }: { mimeType: string; className?: string }) {
  return <File className={className} />;
}

function FileCard({ file }: { file: AttachedFileMeta }) {
  return (
    <div className="flex items-center gap-2 rounded-lg glass-block-subtle px-3 py-2 max-w-[220px]">
      <FileIcon mimeType={file.mimeType} className="h-5 w-5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 overflow-hidden">
        <p className="text-xs font-medium truncate">{file.fileName}</p>
        <p className="text-[10px] text-muted-foreground">
          {file.fileSize > 0 ? formatFileSize(file.fileSize) : 'File'}
        </p>
      </div>
    </div>
  );
}

// ── Props ────────────────────────────────────────────────────────

export interface UserMessagePartProps {
  message: RawMessage;
  onEdit?: (messageId: string, newText: string) => void;
  onDelete?: (messageId: string) => void;
}

// ── Component ────────────────────────────────────────────────────

export const UserMessagePart = memo(
  function UserMessagePart({ message, onEdit, onDelete }: UserMessagePartProps) {
    const { t } = useTranslation('chat');
    const text = extractText(message);
    const images = extractImages(message);
    const attachedFiles = message._attachedFiles || [];

    const [copied, setCopied] = useState(false);
    const [expanded, setExpanded] = useState(false);
    const [mode, setMode] = useState<'view' | 'edit'>('view');
    const [editText, setEditText] = useState(text);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    const isLongText = text.length > MAX_TEXT_LENGTH;
    const displayText = expanded || !isLongText ? text : text.slice(0, MAX_TEXT_LENGTH) + '...';

    const copyContent = useCallback(() => {
      navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }, [text]);

    const handleEdit = () => {
      setEditText(text);
      setMode('edit');
    };

    const handleSaveEdit = () => {
      if (onEdit && message.id && editText.trim()) {
        onEdit(message.id, editText.trim());
      }
      setMode('view');
    };

    const handleCancelEdit = () => {
      setMode('view');
      setEditText(text);
    };

    const handleDelete = useCallback(() => {
      if (onDelete && message.id) {
        onDelete(message.id);
      }
    }, [onDelete, message.id]);

    // Auto-focus textarea in edit mode
    useEffect(() => {
      if (mode === 'edit' && textareaRef.current) {
        textareaRef.current.focus();
        textareaRef.current.setSelectionRange(editText.length, editText.length);
      }
    }, [mode, editText.length]);

    // Auto-resize textarea
    useEffect(() => {
      if (mode === 'edit' && textareaRef.current) {
        const ta = textareaRef.current;
        ta.style.height = 'auto';
        ta.style.height = `${ta.scrollHeight}px`;
      }
    }, [mode, editText]);

    return (
      <div className="flex gap-3 group flex-row-reverse">
        {/* Avatar */}
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full mt-1 bg-primary text-primary-foreground">
          <User className="h-4 w-4" />
        </div>

        {/* Content */}
        <div className="flex flex-col w-full max-w-[80%] space-y-2 items-end">
          {/* Images from content blocks */}
          {images.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {images.map((img, i) => (
                <div key={`content-${i}`} className="w-36 h-36 rounded-xl border overflow-hidden">
                  <img
                    src={`data:${img.mimeType};base64,${img.data}`}
                    alt="attachment"
                    className="w-full h-full object-cover"
                  />
                </div>
              ))}
            </div>
          )}

          {/* File attachments */}
          {attachedFiles.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {attachedFiles.map((file, i) => {
                const isImage = file.mimeType.startsWith('image/');
                if (isImage && images.length > 0) return null;
                if (isImage) {
                  return (
                    <div
                      key={`local-${i}`}
                      className="w-36 h-36 rounded-xl border overflow-hidden bg-muted"
                    >
                      {file.preview ? (
                        <img
                          src={file.preview}
                          alt={file.fileName}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                          <File className="h-8 w-8" />
                        </div>
                      )}
                    </div>
                  );
                }
                return <FileCard key={`local-${i}`} file={file} />;
              })}
            </div>
          )}

          {/* Text bubble or edit mode */}
          {mode === 'edit' ? (
            <div className="w-full rounded-2xl glass-bubble-user px-4 py-3 space-y-2">
              <textarea
                ref={textareaRef}
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                className="w-full bg-transparent text-sm resize-none outline-none min-h-[60px]"
                placeholder={t('message.editPlaceholder')}
              />
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={handleCancelEdit}>
                  {t('message.cancelEdit')}
                </Button>
                <Button size="sm" onClick={handleSaveEdit} disabled={!editText.trim()}>
                  {t('message.saveEdit')}
                </Button>
              </div>
            </div>
          ) : (
            text.trim().length > 0 && (
              <div className="relative rounded-2xl px-4 py-3 glass-bubble-user overflow-hidden">
                {/* Gradient fade for long truncated text */}
                {isLongText && !expanded && (
                  <div className="absolute pointer-events-none bg-gradient-to-t from-primary/10 to-transparent w-full h-24 bottom-0 left-0" />
                )}
                <p className="whitespace-pre-wrap text-sm break-words">{displayText}</p>
                {isLongText && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setExpanded(!expanded)}
                    className="h-auto p-1 text-xs z-10 text-muted-foreground hover:text-foreground self-start mt-1"
                  >
                    <span className="flex items-center gap-1">
                      {t(expanded ? 'message.showLess' : 'message.showMore')}
                      {expanded ? (
                        <ChevronUp className="h-3 w-3" />
                      ) : (
                        <ChevronDown className="h-3 w-3" />
                      )}
                    </span>
                  </Button>
                )}
              </div>
            )
          )}

          {/* Action buttons — visible on hover */}
          {mode === 'view' && text.trim().length > 0 && (
            <div className="flex justify-end opacity-0 group-hover:opacity-100 transition-opacity duration-300">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={copyContent}>
                    {copied ? (
                      <Check className="h-3.5 w-3.5 text-green-500" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">{t('message.copy')}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleEdit}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">{t('message.edit')}</TooltipContent>
              </Tooltip>
              {onDelete && message.id && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 hover:text-destructive"
                      onClick={handleDelete}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent className="text-destructive" side="bottom">
                    {t('message.delete')}
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
          )}

          {/* Timestamp on hover */}
          {message.timestamp && (
            <span className="text-xs text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity duration-200 select-none">
              {formatTimestamp(message.timestamp)}
            </span>
          )}
        </div>
      </div>
    );
  },
  (prev, next) => {
    if (prev.message.id !== next.message.id) return false;
    if (prev.message.content !== next.message.content) return false;
    if (prev.message.timestamp !== next.message.timestamp) return false;
    if (prev.message._attachedFiles !== next.message._attachedFiles) return false;
    if (prev.onEdit !== next.onEdit) return false;
    if (prev.onDelete !== next.onDelete) return false;
    return true;
  }
);
UserMessagePart.displayName = 'UserMessagePart';
