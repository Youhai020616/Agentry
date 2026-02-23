/**
 * AI Model Definitions — curated list of models available for employee selection.
 *
 * These models are available through OpenRouter and other providers.
 * Each model includes metadata for display in the UI and cost estimation.
 *
 * When adding a new model, also consider:
 * - Whether it supports tool use (required for execution-type skills)
 * - Context window size (affects long conversations)
 * - Cost per token (affects credits tracking)
 */

export interface AIModel {
  /** Full model ID as used by the provider (e.g. "anthropic/claude-sonnet-4") */
  id: string;
  /** Human-readable display name */
  name: string;
  /** Short description of the model's strengths */
  description: string;
  /** Provider brand (for grouping in UI) */
  provider: 'anthropic' | 'openai' | 'google' | 'deepseek' | 'meta' | 'qwen' | 'mistral';
  /** Whether this model supports tool/function calling */
  supportsToolUse: boolean;
  /** Context window size in tokens */
  contextWindow: number;
  /** Relative cost tier for UI display */
  costTier: 'free' | 'low' | 'medium' | 'high' | 'premium';
  /** Whether this model is recommended for general use */
  recommended?: boolean;
  /** Tags for filtering */
  tags?: string[];
}

/**
 * Curated list of models available through OpenRouter.
 * Ordered by provider, then by capability (most capable first).
 */
export const OPENROUTER_MODELS: AIModel[] = [
  // ── Anthropic ────────────────────────────────────────────────
  {
    id: 'anthropic/claude-sonnet-4',
    name: 'Claude Sonnet 4',
    description: 'Anthropic 最新旗舰模型，平衡性能与速度',
    provider: 'anthropic',
    supportsToolUse: true,
    contextWindow: 200_000,
    costTier: 'high',
    recommended: true,
    tags: ['flagship', 'tool-use', 'coding'],
  },
  {
    id: 'anthropic/claude-3.5-haiku',
    name: 'Claude 3.5 Haiku',
    description: '快速且经济，支持工具调用，适合自动化任务',
    provider: 'anthropic',
    supportsToolUse: true,
    contextWindow: 200_000,
    costTier: 'low',
    recommended: true,
    tags: ['fast', 'tool-use', 'affordable'],
  },
  {
    id: 'anthropic/claude-opus-4',
    name: 'Claude Opus 4',
    description: 'Anthropic 最强模型，适合复杂推理和编程',
    provider: 'anthropic',
    supportsToolUse: true,
    contextWindow: 200_000,
    costTier: 'premium',
    tags: ['most-capable', 'tool-use', 'coding', 'reasoning'],
  },

  // ── OpenAI ───────────────────────────────────────────────────
  {
    id: 'openai/gpt-4o',
    name: 'GPT-4o',
    description: 'OpenAI 多模态旗舰，支持文本、图像和工具调用',
    provider: 'openai',
    supportsToolUse: true,
    contextWindow: 128_000,
    costTier: 'medium',
    recommended: true,
    tags: ['multimodal', 'tool-use', 'versatile'],
  },
  {
    id: 'openai/gpt-4o-mini',
    name: 'GPT-4o Mini',
    description: '轻量快速，低成本，适合简单任务和自动化',
    provider: 'openai',
    supportsToolUse: true,
    contextWindow: 128_000,
    costTier: 'low',
    tags: ['fast', 'tool-use', 'affordable'],
  },
  {
    id: 'openai/o3-mini',
    name: 'o3-mini',
    description: 'OpenAI 推理模型，擅长数学和编码',
    provider: 'openai',
    supportsToolUse: true,
    contextWindow: 200_000,
    costTier: 'medium',
    tags: ['reasoning', 'tool-use', 'coding'],
  },

  // ── Google ───────────────────────────────────────────────────
  {
    id: 'google/gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    description: '超快速推理，超大上下文窗口，性价比极高',
    provider: 'google',
    supportsToolUse: true,
    contextWindow: 1_000_000,
    costTier: 'low',
    recommended: true,
    tags: ['fast', 'tool-use', 'large-context', 'affordable'],
  },
  {
    id: 'google/gemini-2.5-pro',
    name: 'Gemini 2.5 Pro',
    description: 'Google 最强模型，超大上下文，强推理能力',
    provider: 'google',
    supportsToolUse: true,
    contextWindow: 1_000_000,
    costTier: 'high',
    tags: ['flagship', 'tool-use', 'large-context', 'reasoning'],
  },

  // ── DeepSeek ─────────────────────────────────────────────────
  {
    id: 'deepseek/deepseek-chat',
    name: 'DeepSeek V3',
    description: '高性价比对话模型，支持工具调用',
    provider: 'deepseek',
    supportsToolUse: true,
    contextWindow: 64_000,
    costTier: 'low',
    tags: ['affordable', 'tool-use', 'chinese'],
  },
  {
    id: 'deepseek/deepseek-r1',
    name: 'DeepSeek R1',
    description: '深度推理模型，擅长复杂分析（不支持工具调用）',
    provider: 'deepseek',
    supportsToolUse: false,
    contextWindow: 64_000,
    costTier: 'low',
    tags: ['reasoning', 'affordable', 'chinese'],
  },

  // ── Qwen ─────────────────────────────────────────────────────
  {
    id: 'qwen/qwen3-235b-a22b',
    name: 'Qwen3 235B',
    description: '通义千问最强模型，多语言能力强',
    provider: 'qwen',
    supportsToolUse: true,
    contextWindow: 128_000,
    costTier: 'medium',
    tags: ['tool-use', 'multilingual', 'chinese'],
  },
  {
    id: 'qwen/qwen3-30b-a3b',
    name: 'Qwen3 30B',
    description: '轻量高效，适合常规任务',
    provider: 'qwen',
    supportsToolUse: true,
    contextWindow: 128_000,
    costTier: 'low',
    tags: ['fast', 'tool-use', 'affordable', 'chinese'],
  },

  // ── Meta ─────────────────────────────────────────────────────
  {
    id: 'meta-llama/llama-4-maverick',
    name: 'Llama 4 Maverick',
    description: 'Meta 开源旗舰，多模态能力强',
    provider: 'meta',
    supportsToolUse: true,
    contextWindow: 1_000_000,
    costTier: 'low',
    tags: ['open-source', 'tool-use', 'multimodal'],
  },
  {
    id: 'meta-llama/llama-3.3-70b-instruct',
    name: 'Llama 3.3 70B',
    description: '开源高效模型，适合通用任务',
    provider: 'meta',
    supportsToolUse: true,
    contextWindow: 128_000,
    costTier: 'low',
    tags: ['open-source', 'tool-use', 'affordable'],
  },

  // ── Mistral ──────────────────────────────────────────────────
  {
    id: 'mistralai/mistral-large-2411',
    name: 'Mistral Large',
    description: 'Mistral 旗舰模型，推理能力强',
    provider: 'mistral',
    supportsToolUse: true,
    contextWindow: 128_000,
    costTier: 'medium',
    tags: ['tool-use', 'reasoning', 'european'],
  },
];

/**
 * Get models filtered by tool-use support.
 * Execution-type skills REQUIRE tool-use models.
 */
export function getToolUseModels(): AIModel[] {
  return OPENROUTER_MODELS.filter((m) => m.supportsToolUse);
}

/**
 * Get recommended models (good defaults for most use cases).
 */
export function getRecommendedModels(): AIModel[] {
  return OPENROUTER_MODELS.filter((m) => m.recommended);
}

/**
 * Find a model by its ID.
 */
export function findModelById(id: string): AIModel | undefined {
  return OPENROUTER_MODELS.find((m) => m.id === id);
}

/**
 * Get models grouped by provider for UI display.
 */
export function getModelsByProvider(): Record<string, AIModel[]> {
  const grouped: Record<string, AIModel[]> = {};
  for (const model of OPENROUTER_MODELS) {
    if (!grouped[model.provider]) {
      grouped[model.provider] = [];
    }
    grouped[model.provider].push(model);
  }
  return grouped;
}

/**
 * Provider display names for UI.
 */
export const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google',
  deepseek: 'DeepSeek',
  meta: 'Meta',
  qwen: 'Qwen (通义千问)',
  mistral: 'Mistral',
};

/**
 * Cost tier display labels (for i18n, use keys from employees.modelSelect.costTier.*).
 */
export const COST_TIER_LABELS: Record<string, string> = {
  free: '免费',
  low: '💰',
  medium: '💰💰',
  high: '💰💰💰',
  premium: '💰💰💰💰',
};

/**
 * Format context window size for display.
 * e.g. 128000 → "128K", 1000000 → "1M"
 */
export function formatContextWindow(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(tokens % 1_000_000 === 0 ? 0 : 1)}M`;
  }
  return `${Math.round(tokens / 1_000)}K`;
}
