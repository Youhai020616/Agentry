/**
 * StudioService — Media Studio Pipeline Backend
 *
 * Handles the 5-step content creation pipeline:
 *   Step 0: Brand Analysis    → new-media employee via TaskExecutor
 *   Step 1: Text Generation   → new-media employee via TaskExecutor
 *   Step 2: Image Generation  → DeerAPI direct HTTP (gemini-3-pro-image)
 *   Step 3: Video Generation  → Configurable API (default: DeerAPI)
 *   Step 4: Publish           → publisher-xhs/douyin employee via TaskExecutor
 *
 * All methods push real-time logs to the renderer via mainWindow.webContents.send('studio:log', ...).
 * Cancellation is managed internally via AbortController (triggered by studio:cancel IPC).
 */
import { BrowserWindow, app } from 'electron';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { logger } from '../utils/logger';
import { getSkillConfig } from '../utils/skill-config';
import type { EngineRef } from '../main/ipc-handlers';
import type { GatewayManager } from '../gateway/manager';
import type {
  StudioStep,
  ApiLogEntry,
  StudioLogEvent,
  BrandAnalysisInput,
  BrandAnalysisResult,
  TextGenerationResult,
  ImageGenerationResult,
  VideoGenerationResult,
  Platform,
} from '../../src/types/media-studio';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEERAPI_BASE_URL = 'https://api.deerapi.com/v1';
const IMAGE_MODEL = 'gemini-3-pro-image';
const DEFAULT_VIDEO_MODEL = 'veo-2.0-generate-001';
const HTTP_TIMEOUT_MS = 120_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function logEntry(type: ApiLogEntry['type'], message: string): ApiLogEntry {
  return {
    id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp: Date.now(),
    type,
    message,
  };
}

/**
 * Try to parse a JSON block from LLM text output.
 * Handles markdown fenced code blocks and raw JSON.
 */
function extractJson<T>(text: string): T {
  // Try to find JSON in markdown code block
  const fencedMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  const candidate = fencedMatch ? fencedMatch[1].trim() : text.trim();

  // Find the first { or [ and last } or ]
  const startObj = candidate.indexOf('{');
  const startArr = candidate.indexOf('[');
  const start =
    startObj >= 0 && startArr >= 0
      ? Math.min(startObj, startArr)
      : startObj >= 0
        ? startObj
        : startArr;

  if (start < 0) {
    throw new Error('No JSON object found in response');
  }

  const isArray = candidate[start] === '[';
  const endChar = isArray ? ']' : '}';
  const lastEnd = candidate.lastIndexOf(endChar);
  if (lastEnd < 0) {
    throw new Error('Malformed JSON in response');
  }

  return JSON.parse(candidate.slice(start, lastEnd + 1));
}

/**
 * Extract base64 image data from a DeerAPI / Gemini response.
 * Mirrors the Python generate_image.py parsing logic.
 */
function extractImageFromResponse(result: Record<string, unknown>): {
  data: string | null;
  format: string;
  url: string | null;
} {
  const choices = (result.choices as Array<Record<string, unknown>>) ?? [];
  if (!choices.length) return { data: null, format: 'png', url: null };

  const message = (choices[0].message as Record<string, unknown>) ?? {};
  const content = message.content;
  let imageData: string | null = null;
  let imageFormat = 'png';

  if (typeof content === 'string') {
    // 1. Markdown image: ![...](data:image/jpeg;base64,xxxxx)
    const mdMatch = content.match(/!\[.*?\]\(data:image\/(\w+);base64,([A-Za-z0-9+/=]+)\)/);
    if (mdMatch) {
      imageFormat = mdMatch[1];
      imageData = mdMatch[2];
    }

    // 2. data URL at start
    if (!imageData && content.startsWith('data:image')) {
      const fmtMatch = content.match(/data:image\/(\w+);base64,/);
      if (fmtMatch) imageFormat = fmtMatch[1];
      const parts = content.split(',');
      if (parts.length > 1) imageData = parts[1];
    }

    // 3. data URL embedded in text
    if (!imageData && content.includes('data:image')) {
      const dataMatch = content.match(/data:image\/(\w+);base64,([A-Za-z0-9+/=]+)/);
      if (dataMatch) {
        imageFormat = dataMatch[1];
        imageData = dataMatch[2];
      }
    }

    // 4. Raw base64 (long string, not a URL)
    if (!imageData && content.length > 1000 && !content.startsWith('http')) {
      // Validate by round-tripping: decode then re-encode and compare
      const cleaned = content.replace(/\s/g, '');
      if (/^[A-Za-z0-9+/=]+$/.test(cleaned)) {
        const decoded = Buffer.from(cleaned, 'base64');
        if (decoded.length > 0 && decoded.toString('base64') === cleaned) {
          imageData = cleaned;
        }
      }
    }

    // 5. Plain URL
    if (!imageData && content.startsWith('http')) {
      return { data: null, format: imageFormat, url: content.trim() };
    }
  }

  // Content is multimodal list
  if (Array.isArray(content)) {
    for (const item of content) {
      if (typeof item === 'object' && item !== null) {
        const obj = item as Record<string, unknown>;
        if (obj.type === 'image' || 'image' in obj) {
          const img = (obj.image ?? obj) as Record<string, unknown>;
          if (typeof img === 'string') {
            imageData = img as unknown as string;
          } else {
            imageData = (img.data as string) ?? (img.base64 as string) ?? null;
          }
          break;
        }
      }
    }
  }

  // message.image field
  if (!imageData && 'image' in message) {
    const img = message.image;
    if (typeof img === 'object' && img !== null) {
      const o = img as Record<string, unknown>;
      imageData = (o.data as string) ?? (o.base64 as string) ?? null;
      if (!imageData && typeof o.url === 'string') {
        return { data: null, format: imageFormat, url: o.url };
      }
    } else if (typeof img === 'string') {
      if (img.startsWith('http')) return { data: null, format: imageFormat, url: img };
      imageData = img;
    }
  }

  return { data: imageData, format: imageFormat, url: null };
}

// ---------------------------------------------------------------------------
// StudioService
// ---------------------------------------------------------------------------

export class StudioService {
  private abortController: AbortController | null = null;

  constructor(
    private engineRef: EngineRef,
    private gatewayManager: GatewayManager,
    private mainWindow: BrowserWindow
  ) {}

  // ── Internal helpers ─────────────────────────────────────────────

  private async getLazy() {
    if (!this.engineRef.current) throw new Error('Engine not initialized');
    return this.engineRef.current.getLazy(this.gatewayManager);
  }

  private emitLog(step: StudioStep, entry: ApiLogEntry): void {
    try {
      if (!this.mainWindow.isDestroyed()) {
        const event: StudioLogEvent = { ...entry, step };
        this.mainWindow.webContents.send('studio:log', event);
      }
    } catch {
      // window may have been closed
    }
  }

  private checkAborted(signal: AbortSignal): void {
    if (signal.aborted) throw new Error('Studio pipeline cancelled');
  }

  /**
   * Get DeerAPI key from skill config (env.DEERAPI_KEY on the new-media skill).
   * Falls back to env.DEERAPI_KEY on any skill that has it.
   */
  private getDeerApiKey(): string | null {
    // Primary: new-media skill config
    const config = getSkillConfig('new-media');
    if (config?.env?.DEERAPI_KEY) return config.env.DEERAPI_KEY;
    if (config?.apiKey) return config.apiKey;

    // Fallback: publisher-xhs skill config
    const xhsConfig = getSkillConfig('publisher-xhs');
    if (xhsConfig?.env?.DEERAPI_KEY) return xhsConfig.env.DEERAPI_KEY;

    // Fallback: environment variable
    return process.env.DEERAPI_KEY ?? null;
  }

  private getStudioImagesDir(): string {
    const dir = join(app.getPath('userData'), 'studio-images');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    return dir;
  }

  // ── Step 0: Brand Analysis ───────────────────────────────────────

  async brandAnalysis(params: BrandAnalysisInput): Promise<BrandAnalysisResult> {
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    this.emitLog(0, logEntry('info', '开始品牌竞品分析...'));

    const lazy = await this.getLazy();
    this.checkAborted(signal);

    const platformsStr = params.platforms.join('、');
    const competitorsStr = params.competitors ? `\n重点分析竞品: ${params.competitors}` : '';

    const prompt = `你是一位资深的新媒体营销顾问。请对以下品牌进行全面的竞品分析和内容策略规划。

品牌名称: ${params.brandName}
所属行业: ${params.industry}
目标平台: ${platformsStr}${competitorsStr}

请以 JSON 格式返回分析结果，严格遵循以下结构（不要添加任何 JSON 之外的文字）：

\`\`\`json
{
  "competitors": [
    {
      "name": "竞品名称",
      "platform": "主要平台",
      "followers": "粉丝数（如 320万）",
      "style": "内容风格描述",
      "strengths": ["优势1", "优势2", "优势3"]
    }
  ],
  "strategy": {
    "positioning": "品牌定位建议",
    "toneOfVoice": "内容调性",
    "contentPillars": ["内容支柱1", "内容支柱2", "内容支柱3", "内容支柱4"],
    "postFrequency": "发布频率建议"
  },
  "calendar": [
    { "day": "周一", "platform": "xhs", "topic": "话题描述", "type": "图文" },
    { "day": "周二", "platform": "douyin", "topic": "话题描述", "type": "短视频" }
  ]
}
\`\`\`

要求:
- competitors 至少分析 2 个竞品
- calendar 规划一周 7 天的内容
- platform 字段只能是 "xhs", "douyin", "wechat" 之一
- 所有文字使用中文`;

    this.emitLog(0, logEntry('request', `POST → new-media employee — 品牌竞品分析`));

    try {
      const result = await lazy.taskExecutor.executeAdHoc('new-media', prompt, {
        timeoutMs: 120_000,
      });
      this.checkAborted(signal);

      if (!result.success || !result.output) {
        throw new Error(result.output || 'Brand analysis failed — no response');
      }

      this.emitLog(0, logEntry('response', `200 OK — ${result.output.length} chars`));
      this.emitLog(0, logEntry('info', '正在解析分析结果...'));

      const parsed = extractJson<BrandAnalysisResult>(result.output);

      // Validate minimal structure
      if (!parsed.competitors || !parsed.strategy || !parsed.calendar) {
        throw new Error('Incomplete brand analysis result');
      }

      this.emitLog(0, logEntry('success', '品牌诊断完成！'));
      return parsed;
    } catch (err) {
      if (signal.aborted) throw new Error('Studio pipeline cancelled', { cause: err });
      this.emitLog(0, logEntry('error', `品牌分析失败: ${String(err)}`));
      throw new Error(`Brand analysis failed: ${String(err)}`, { cause: err });
    }
  }

  // ── Step 1: Text Generation ──────────────────────────────────────

  async textGeneration(params: {
    brandAnalysis: BrandAnalysisResult;
    platform: Platform;
    contentType?: string;
  }): Promise<TextGenerationResult> {
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    this.emitLog(1, logEntry('info', '开始生成文案...'));

    const lazy = await this.getLazy();
    this.checkAborted(signal);

    const strategy = params.brandAnalysis.strategy;
    const platformName =
      params.platform === 'xhs' ? '小红书' : params.platform === 'douyin' ? '抖音' : '微信公众号';

    const prompt = `你是一位专业的新媒体文案创作者。请根据以下品牌策略，为 ${platformName} 平台创作一篇优质内容。

品牌定位: ${strategy.positioning}
内容调性: ${strategy.toneOfVoice}
内容支柱: ${strategy.contentPillars.join('、')}
内容类型: ${params.contentType || '图文笔记'}

请以 JSON 格式返回文案，严格遵循以下结构（不要添加任何 JSON 之外的文字）：

\`\`\`json
{
  "title": "标题（${platformName === '小红书' ? '20字以内，吸引点击' : '简洁有力'}）",
  "body": "正文内容（${platformName === '小红书' ? '300-800字，分段落，加emoji' : '200-500字'}）",
  "tags": ["标签1", "标签2", "标签3", "标签4", "标签5"],
  "wordCount": 字数,
  "platform": "${params.platform}"
}
\`\`\`

要求:
- 标题要有吸引力，适合${platformName}平台风格
- 正文分段落，使用 emoji 增加可读性
- tags 包含 5-10 个相关标签
- 所有文字使用中文`;

    this.emitLog(1, logEntry('request', `POST → new-media employee — ${platformName}文案生成`));

    try {
      const result = await lazy.taskExecutor.executeAdHoc('new-media', prompt, {
        timeoutMs: 90_000,
      });
      this.checkAborted(signal);

      if (!result.success || !result.output) {
        throw new Error(result.output || 'Text generation failed — no response');
      }

      this.emitLog(1, logEntry('response', `200 OK — ${result.output.length} chars`));
      this.emitLog(1, logEntry('info', '正在解析文案...'));

      const parsed = extractJson<TextGenerationResult>(result.output);

      if (!parsed.title || !parsed.body) {
        throw new Error('Incomplete text generation result');
      }

      // Ensure wordCount is accurate
      parsed.wordCount = parsed.body.length;
      // Ensure platform matches
      parsed.platform = params.platform;

      this.emitLog(1, logEntry('success', `文案生成完成！标题: "${parsed.title}"`));
      return parsed;
    } catch (err) {
      if (signal.aborted) throw new Error('Studio pipeline cancelled', { cause: err });
      this.emitLog(1, logEntry('error', `文案生成失败: ${String(err)}`));
      throw new Error(`Text generation failed: ${String(err)}`, { cause: err });
    }
  }

  // ── Step 2: Image Generation ─────────────────────────────────────

  async imageGeneration(params: {
    text: TextGenerationResult;
    count?: number;
    imageApiKey?: string;
    imageModel?: string;
  }): Promise<ImageGenerationResult> {
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    const count = params.count ?? 3;
    this.emitLog(2, logEntry('info', `开始生成 ${count} 张配图...`));

    const apiKey = params.imageApiKey || this.getDeerApiKey();
    if (!apiKey) {
      this.emitLog(
        2,
        logEntry('error', 'DeerAPI Key 未配置。请在 Settings → Employee Secrets 中设置 DEERAPI_KEY')
      );
      throw new Error(
        'DeerAPI Key not configured. Set DEERAPI_KEY in Settings > Employee Secrets for the new-media employee.'
      );
    }

    this.checkAborted(signal);

    // Generate image prompts based on the text content
    const imagePrompts = this.buildImagePrompts(params.text, count);
    const images: ImageGenerationResult['images'] = [];
    const outputDir = this.getStudioImagesDir();

    // Default gradient colors for fallback
    const gradients = [
      { from: '#fbc2eb', to: '#f8a4d0' },
      { from: '#ffecd2', to: '#fcb69f' },
      { from: '#ff9a9e', to: '#fecfef' },
      { from: '#e0c3fc', to: '#c2b4f2' },
      { from: '#89f7fe', to: '#a0ecb1' },
    ];

    for (let i = 0; i < imagePrompts.length; i++) {
      this.checkAborted(signal);

      const { label, prompt } = imagePrompts[i];
      this.emitLog(
        2,
        logEntry(
          'request',
          `POST ${DEERAPI_BASE_URL}/chat/completions — 图片 ${i + 1}/${count}: ${label}`
        )
      );

      try {
        const response = await fetch(`${DEERAPI_BASE_URL}/chat/completions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: params.imageModel || IMAGE_MODEL,
            messages: [{ role: 'user', content: prompt }],
          }),
          signal: AbortSignal.any([signal, AbortSignal.timeout(HTTP_TIMEOUT_MS)]),
        });

        if (!response.ok) {
          const errText = await response.text().catch(() => '');
          this.emitLog(
            2,
            logEntry(
              'error',
              `图片 ${i + 1} 生成失败: HTTP ${response.status} — ${errText.slice(0, 200)}`
            )
          );
          // Push a fallback placeholder
          images.push({
            id: `img-${i + 1}`,
            label,
            gradientFrom: gradients[i % gradients.length].from,
            gradientTo: gradients[i % gradients.length].to,
          });
          continue;
        }

        const result = (await response.json()) as Record<string, unknown>;
        const extracted = extractImageFromResponse(result);

        if (extracted.data) {
          // Save base64 to file
          const ext = extracted.format === 'jpeg' ? 'jpg' : extracted.format;
          const filename = `studio_${Date.now()}_${i + 1}.${ext}`;
          const filePath = join(outputDir, filename);

          writeFileSync(filePath, Buffer.from(extracted.data, 'base64'));

          this.emitLog(2, logEntry('success', `图片 ${i + 1} 已保存: ${filename}`));
          images.push({
            id: `img-${i + 1}`,
            label,
            filePath,
            gradientFrom: gradients[i % gradients.length].from,
            gradientTo: gradients[i % gradients.length].to,
          });
        } else if (extracted.url) {
          this.emitLog(2, logEntry('success', `图片 ${i + 1} URL 已获取`));
          images.push({
            id: `img-${i + 1}`,
            label,
            url: extracted.url,
            gradientFrom: gradients[i % gradients.length].from,
            gradientTo: gradients[i % gradients.length].to,
          });
        } else {
          this.emitLog(2, logEntry('error', `图片 ${i + 1}: 无法从响应中提取图片数据`));
          images.push({
            id: `img-${i + 1}`,
            label,
            gradientFrom: gradients[i % gradients.length].from,
            gradientTo: gradients[i % gradients.length].to,
          });
        }
      } catch (err) {
        if (signal.aborted) throw new Error('Studio pipeline cancelled', { cause: err });
        this.emitLog(2, logEntry('error', `图片 ${i + 1} 生成异常: ${String(err)}`));
        images.push({
          id: `img-${i + 1}`,
          label,
          gradientFrom: gradients[i % gradients.length].from,
          gradientTo: gradients[i % gradients.length].to,
        });
      }
    }

    if (images.length === 0) {
      throw new Error('No images generated');
    }

    this.emitLog(2, logEntry('success', `图片生成完成！共 ${images.length} 张`));
    return { images };
  }

  private buildImagePrompts(
    text: TextGenerationResult,
    count: number
  ): Array<{ label: string; prompt: string }> {
    const baseContext = `品牌内容标题: "${text.title}"\n主题: ${text.tags.slice(0, 3).join(', ')}`;

    const templates = [
      {
        label: '封面图',
        prompt: `Generate a visually stunning social media cover image for the following Chinese content. The image should be eye-catching, modern, and suitable for Xiaohongshu/Instagram style posts. No text in the image.\n\n${baseContext}\n\nStyle: Clean, aesthetic, high-quality product/lifestyle photography style`,
      },
      {
        label: '内容详情图',
        prompt: `Generate a detailed infographic-style image for social media that visually represents the key points of this content. Modern, clean design.\n\n${baseContext}\n\nStyle: Flat design, pastel colors, informative layout`,
      },
      {
        label: '氛围图',
        prompt: `Generate an atmospheric mood image that captures the essence of this brand content. Lifestyle photography style, warm and inviting.\n\n${baseContext}\n\nStyle: Lifestyle photography, natural lighting, warm tones`,
      },
      {
        label: '产品展示图',
        prompt: `Generate a product showcase image with a clean, minimal background. The image should feel premium and professional.\n\n${baseContext}\n\nStyle: Product photography, minimal background, professional lighting`,
      },
      {
        label: '对比效果图',
        prompt: `Generate a before/after or comparison style image suitable for social media content. Clean layout, clear visual distinction.\n\n${baseContext}\n\nStyle: Split comparison layout, clean design`,
      },
    ];

    return templates.slice(0, count);
  }

  // ── Step 3: Video Generation ─────────────────────────────────────

  async videoGeneration(params: {
    text: TextGenerationResult;
    images: ImageGenerationResult;
    style?: string;
    videoModel?: string;
    videoApiUrl?: string;
    videoApiKey?: string;
  }): Promise<VideoGenerationResult> {
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    this.emitLog(3, logEntry('info', '开始生成视频...'));

    const model = params.videoModel || DEFAULT_VIDEO_MODEL;
    const apiUrl = params.videoApiUrl || `${DEERAPI_BASE_URL}/chat/completions`;
    const apiKey = params.videoApiKey || this.getDeerApiKey();

    if (!apiKey) {
      const errorResult: VideoGenerationResult = {
        title: params.text.title,
        duration: '00:00',
        prompt: '',
        params: { model, mode: 'text2video' },
        status: 'failed',
        error: 'API Key 未配置。请在 Settings 中配置视频生成 API Key。',
      };
      this.emitLog(3, logEntry('error', errorResult.error!));
      return errorResult;
    }

    const videoPrompt = `Create a short promotional video based on the following content: "${params.text.title}". ${params.style || 'Modern, dynamic, suitable for social media short-form video.'}`;

    this.emitLog(3, logEntry('request', `POST ${apiUrl} — model: ${model}`));

    try {
      this.checkAborted(signal);

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: videoPrompt }],
        }),
        signal: AbortSignal.any([signal, AbortSignal.timeout(HTTP_TIMEOUT_MS)]),
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        const errorMsg =
          response.status === 404 || response.status === 400
            ? `视频生成 API 不支持模型 ${model}。当前 DeerAPI 可能不支持视频生成，请配置其他视频 API。`
            : `视频生成失败: HTTP ${response.status} — ${errText.slice(0, 200)}`;

        this.emitLog(3, logEntry('error', errorMsg));
        return {
          title: params.text.title,
          duration: '00:00',
          prompt: videoPrompt,
          params: { model, mode: 'text2video' },
          status: 'failed',
          error: errorMsg,
        };
      }

      const result = (await response.json()) as Record<string, unknown>;
      this.checkAborted(signal);

      // Try to extract video URL from response
      const choices = (result.choices as Array<Record<string, unknown>>) ?? [];
      let videoUrl: string | undefined;

      if (choices.length > 0) {
        const message = (choices[0].message as Record<string, unknown>) ?? {};
        const content = message.content;
        if (typeof content === 'string' && content.startsWith('http')) {
          videoUrl = content.trim();
        }
      }

      this.emitLog(
        3,
        logEntry('success', videoUrl ? '视频生成完成！' : '视频生成请求已提交（可能需要异步处理）')
      );

      return {
        title: params.text.title,
        duration: '00:15',
        prompt: videoPrompt,
        params: { model, mode: 'text2video', resolution: '1080x1920' },
        videoUrl,
        status: videoUrl ? 'completed' : 'generating',
      };
    } catch (err) {
      if (signal.aborted) throw new Error('Studio pipeline cancelled', { cause: err });
      const errorMsg = `视频生成异常: ${String(err)}`;
      this.emitLog(3, logEntry('error', errorMsg));
      return {
        title: params.text.title,
        duration: '00:00',
        prompt: videoPrompt,
        params: { model, mode: 'text2video' },
        status: 'failed',
        error: errorMsg,
      };
    }
  }

  // ── Step 4: Publish ──────────────────────────────────────────────

  async publish(params: {
    platform: Platform;
    text: TextGenerationResult;
    images: ImageGenerationResult;
    video?: VideoGenerationResult;
  }): Promise<{ success: boolean; url?: string; error?: string }> {
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    const platformName =
      params.platform === 'xhs' ? '小红书' : params.platform === 'douyin' ? '抖音' : '微信公众号';
    const employeeId =
      params.platform === 'xhs'
        ? 'publisher-xhs'
        : params.platform === 'douyin'
          ? 'publisher-douyin'
          : null;

    this.emitLog(4, logEntry('info', `准备发布到 ${platformName}...`));

    if (!employeeId) {
      const error = `暂不支持发布到 ${platformName}，仅支持小红书和抖音`;
      this.emitLog(4, logEntry('error', error));
      return { success: false, error };
    }

    const lazy = await this.getLazy();
    this.checkAborted(signal);

    // Build the image paths/URLs for the publish instruction
    const imagePaths = params.images.images
      .filter((img) => img.filePath || img.url)
      .map((img) => img.filePath || img.url)
      .join('\n');

    const publishPrompt = `请发布以下内容到${platformName}：

标题: ${params.text.title}

正文:
${params.text.body}

标签: ${params.text.tags.map((t) => `#${t}`).join(' ')}

${imagePaths ? `图片文件路径:\n${imagePaths}` : '（无图片）'}

${params.video?.videoUrl ? `视频链接: ${params.video.videoUrl}` : ''}

请按照你的发布流程执行发布操作。`;

    this.emitLog(4, logEntry('request', `POST → ${employeeId} employee — 发布${platformName}内容`));

    try {
      const result = await lazy.taskExecutor.executeAdHoc(employeeId, publishPrompt, {
        timeoutMs: 180_000,
      });
      this.checkAborted(signal);

      if (result.success) {
        this.emitLog(4, logEntry('success', `发布成功！内容已上线到${platformName}`));
        return { success: true };
      } else {
        const error = result.output || '发布失败';
        this.emitLog(4, logEntry('error', `发布失败: ${error}`));
        return { success: false, error };
      }
    } catch (err) {
      if (signal.aborted) throw new Error('Studio pipeline cancelled', { cause: err });
      const error = `发布异常: ${String(err)}`;
      this.emitLog(4, logEntry('error', error));
      return { success: false, error };
    }
  }

  // ── Cancel ───────────────────────────────────────────────────────

  cancel(): void {
    logger.info('[StudioService] Cancel requested');
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }
}
