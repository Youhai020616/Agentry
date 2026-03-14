/**
 * File Staging IPC Handlers
 * Stage files to ~/.openclaw/media/outbound/ for gateway access.
 */
import { ipcMain, nativeImage } from 'electron';
import {
  existsSync,
  copyFileSync,
  statSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join, extname, basename } from 'node:path';
import crypto from 'node:crypto';
import type { IpcContext } from './types';

const EXT_MIME_MAP: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.bmp': 'image/bmp', '.ico': 'image/x-icon',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo', '.mkv': 'video/x-matroska', '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.flac': 'audio/flac',
  '.pdf': 'application/pdf', '.zip': 'application/zip', '.gz': 'application/gzip',
  '.tar': 'application/x-tar', '.7z': 'application/x-7z-compressed',
  '.rar': 'application/vnd.rar', '.json': 'application/json', '.xml': 'application/xml',
  '.csv': 'text/csv', '.txt': 'text/plain', '.md': 'text/markdown', '.html': 'text/html',
  '.css': 'text/css', '.js': 'text/javascript', '.ts': 'text/typescript',
  '.py': 'text/x-python', '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

function getMimeType(ext: string): string {
  return EXT_MIME_MAP[ext.toLowerCase()] || 'application/octet-stream';
}

function mimeToExt(mimeType: string): string {
  for (const [ext, mime] of Object.entries(EXT_MIME_MAP)) {
    if (mime === mimeType) return ext;
  }
  return '';
}

const OUTBOUND_DIR = join(homedir(), '.openclaw', 'media', 'outbound');

function generateImagePreview(filePath: string, mimeType: string): string | null {
  try {
    const img = nativeImage.createFromPath(filePath);
    if (img.isEmpty()) return null;
    const size = img.getSize();
    const maxDim = 512;
    if (size.width > maxDim || size.height > maxDim) {
      const resized =
        size.width >= size.height
          ? img.resize({ width: maxDim })
          : img.resize({ height: maxDim });
      return `data:image/png;base64,${resized.toPNG().toString('base64')}`;
    }
    const buf = readFileSync(filePath);
    return `data:${mimeType};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

export function register(_ctx: IpcContext): void {
  ipcMain.handle('file:stage', async (_, filePaths: string[]) => {
    mkdirSync(OUTBOUND_DIR, { recursive: true });
    const results = [];
    for (const filePath of filePaths) {
      const id = crypto.randomUUID();
      const ext = extname(filePath);
      const stagedPath = join(OUTBOUND_DIR, `${id}${ext}`);
      copyFileSync(filePath, stagedPath);
      const stat = statSync(stagedPath);
      const mimeType = getMimeType(ext);
      const fileName = basename(filePath);
      let preview: string | null = null;
      if (mimeType.startsWith('image/')) {
        preview = generateImagePreview(stagedPath, mimeType);
      }
      results.push({ id, fileName, mimeType, fileSize: stat.size, stagedPath, preview });
    }
    return results;
  });

  ipcMain.handle(
    'file:stageBuffer',
    async (_, payload: { base64: string; fileName: string; mimeType: string }) => {
      mkdirSync(OUTBOUND_DIR, { recursive: true });
      const id = crypto.randomUUID();
      const ext = extname(payload.fileName) || mimeToExt(payload.mimeType);
      const stagedPath = join(OUTBOUND_DIR, `${id}${ext}`);
      const buffer = Buffer.from(payload.base64, 'base64');
      writeFileSync(stagedPath, buffer);
      const mimeType = payload.mimeType || getMimeType(ext);
      const fileSize = buffer.length;
      let preview: string | null = null;
      if (mimeType.startsWith('image/')) {
        preview = generateImagePreview(stagedPath, mimeType);
      }
      return { id, fileName: payload.fileName, mimeType, fileSize, stagedPath, preview };
    }
  );

  ipcMain.handle(
    'media:getThumbnails',
    async (_, paths: Array<{ filePath: string; mimeType: string }>) => {
      const results: Record<string, { preview: string | null; fileSize: number }> = {};
      for (const { filePath, mimeType } of paths) {
        try {
          if (!existsSync(filePath)) {
            results[filePath] = { preview: null, fileSize: 0 };
            continue;
          }
          const stat = statSync(filePath);
          let preview: string | null = null;
          if (mimeType.startsWith('image/')) {
            preview = generateImagePreview(filePath, mimeType);
          }
          results[filePath] = { preview, fileSize: stat.size };
        } catch {
          results[filePath] = { preview: null, fileSize: 0 };
        }
      }
      return results;
    }
  );
}
