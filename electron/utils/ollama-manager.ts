/**
 * Ollama Manager
 * Manages local Ollama installation: detection, model listing, pull, delete
 */
import { execFile } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { platform } from 'node:os';
import { existsSync } from 'node:fs';
import { logger } from './logger';

const OLLAMA_API_BASE = 'http://localhost:11434';

export interface OllamaModel {
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

export interface OllamaStatus {
  installed: boolean;
  running: boolean;
  models: OllamaModel[];
}

export interface OllamaPullProgress {
  status: string;
  digest?: string;
  total?: number;
  completed?: number;
}

/**
 * Make an HTTP request to the Ollama API
 */
function ollamaRequest(
  method: string,
  path: string,
  body?: unknown,
  onData?: (chunk: string) => void
): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, OLLAMA_API_BASE);
    const postData = body ? JSON.stringify(body) : undefined;

    const req = httpRequest(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(postData ? { 'Content-Length': Buffer.byteLength(postData) } : {}),
        },
        timeout: 10000,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => {
          const str = chunk.toString();
          if (onData) {
            onData(str);
          }
          data += str;
        });
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve(data);
          } else {
            reject(new Error(`Ollama API error ${res.statusCode}: ${data}`));
          }
        });
      }
    );

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Ollama API request timed out'));
    });

    if (postData) {
      req.write(postData);
    }
    req.end();
  });
}

/**
 * Make a streaming HTTP request to the Ollama API (for pull progress)
 */
function ollamaStreamRequest(
  method: string,
  path: string,
  body: unknown,
  onLine: (line: string) => void,
  signal?: AbortSignal
): Promise<void> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, OLLAMA_API_BASE);
    const postData = JSON.stringify(body);

    const req = httpRequest(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
        },
      },
      (res) => {
        if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
          let errData = '';
          res.on('data', (chunk: Buffer) => {
            errData += chunk.toString();
          });
          res.on('end', () => {
            reject(new Error(`Ollama API error ${res.statusCode}: ${errData}`));
          });
          return;
        }

        let buffer = '';
        res.on('data', (chunk: Buffer) => {
          buffer += chunk.toString();
          const lines = buffer.split('\n');
          // Keep the last partial line in the buffer
          buffer = lines.pop() ?? '';
          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed) {
              onLine(trimmed);
            }
          }
        });
        res.on('end', () => {
          // Process any remaining data
          if (buffer.trim()) {
            onLine(buffer.trim());
          }
          resolve();
        });
      }
    );

    req.on('error', reject);

    if (signal) {
      signal.addEventListener('abort', () => {
        req.destroy();
        reject(new Error('Pull cancelled'));
      });
    }

    req.write(postData);
    req.end();
  });
}

export class OllamaManager {
  /**
   * Check if Ollama binary is installed on the system
   */
  async checkInstalled(): Promise<boolean> {
    // Check common binary locations first
    const commonPaths =
      platform() === 'darwin'
        ? ['/usr/local/bin/ollama', '/opt/homebrew/bin/ollama', '/Applications/Ollama.app']
        : platform() === 'win32'
          ? ['C:\\Program Files\\Ollama\\ollama.exe', 'C:\\Users\\ollama\\ollama.exe']
          : ['/usr/local/bin/ollama', '/usr/bin/ollama', '/snap/bin/ollama'];

    for (const p of commonPaths) {
      if (existsSync(p)) {
        return true;
      }
    }

    // Try running `which ollama` / `where ollama`
    return new Promise((resolve) => {
      const cmd = platform() === 'win32' ? 'where' : 'which';
      execFile(cmd, ['ollama'], (error) => {
        resolve(!error);
      });
    });
  }

  /**
   * Check if Ollama server is currently running
   */
  async isRunning(): Promise<boolean> {
    try {
      await ollamaRequest('GET', '/api/tags');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * List all locally installed models
   */
  async listModels(): Promise<OllamaModel[]> {
    try {
      const data = await ollamaRequest('GET', '/api/tags');
      const parsed = JSON.parse(data) as { models?: OllamaModel[] };
      return parsed.models ?? [];
    } catch (error) {
      logger.error('Failed to list Ollama models:', error);
      return [];
    }
  }

  /**
   * Pull (download) a model, emitting progress events
   */
  async pullModel(
    name: string,
    onProgress: (progress: OllamaPullProgress) => void,
    signal?: AbortSignal
  ): Promise<void> {
    await ollamaStreamRequest(
      'POST',
      '/api/pull',
      { name, stream: true },
      (line) => {
        try {
          const parsed = JSON.parse(line) as OllamaPullProgress;
          onProgress(parsed);
        } catch {
          // Ignore malformed lines
        }
      },
      signal
    );
  }

  /**
   * Delete a locally installed model
   */
  async deleteModel(name: string): Promise<boolean> {
    try {
      await ollamaRequest('DELETE', '/api/delete', { name });
      return true;
    } catch (error) {
      logger.error(`Failed to delete Ollama model ${name}:`, error);
      return false;
    }
  }

  /**
   * Get comprehensive Ollama status
   */
  async getStatus(): Promise<OllamaStatus> {
    const installed = await this.checkInstalled();
    if (!installed) {
      return { installed: false, running: false, models: [] };
    }

    const running = await this.isRunning();
    if (!running) {
      return { installed: true, running: false, models: [] };
    }

    const models = await this.listModels();
    return { installed, running, models };
  }
}

/** Singleton instance */
export const ollamaManager = new OllamaManager();
