/**
 * Media Studio Store Tests
 * Tests for navigation, filters, pipeline (IPC-backed), CRM, and mode toggle.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useMediaStudioStore } from '@/stores/media-studio';
import type {
  BrandAnalysisResult,
  TextGenerationResult,
  ImageGenerationResult,
  VideoGenerationResult,
} from '@/types/media-studio';

// ---------------------------------------------------------------------------
// Mock IPC response data
// ---------------------------------------------------------------------------

const MOCK_BRAND_ANALYSIS: BrandAnalysisResult = {
  competitors: [
    {
      name: '完美日记',
      platform: '小红书',
      followers: '320 万',
      style: '国潮美妆',
      strengths: ['高频上新', '素人种草'],
    },
    {
      name: '花西子',
      platform: '小红书',
      followers: '180 万',
      style: '东方美学',
      strengths: ['视觉差异化', '文化故事线'],
    },
  ],
  strategy: {
    positioning: '学生党平价美妆指南',
    toneOfVoice: '闺蜜分享式',
    contentPillars: ['妆教干货', '平价测评', '成分科普', '穿搭灵感'],
    postFrequency: '小红书 3 篇/周',
  },
  calendar: [
    { day: '周一', platform: 'xhs', topic: '好物分享', type: '图文' },
    { day: '周二', platform: 'douyin', topic: '妆教', type: '短视频' },
    { day: '周三', platform: 'xhs', topic: '成分科普', type: '图文' },
    { day: '周四', platform: 'wechat', topic: '长文', type: '公众号文章' },
    { day: '周五', platform: 'xhs', topic: 'OOTD', type: '图文' },
    { day: '周六', platform: 'douyin', topic: '探店', type: '短视频' },
    { day: '周日', platform: 'xhs', topic: '数据复盘', type: '图文' },
  ],
};

const MOCK_TEXT_GENERATION: TextGenerationResult = {
  title: '夏日清透妆教程 | 学生党平价好物推荐',
  body: '测试正文内容',
  tags: ['#夏日妆容', '#学生党', '#平价好物'],
  wordCount: 100,
  platform: 'xhs',
};

const MOCK_IMAGE_GENERATION: ImageGenerationResult = {
  images: [
    {
      id: 'img-1',
      label: '封面图',
      gradientFrom: '#fbc2eb',
      gradientTo: '#f8a4d0',
      filePath: '/tmp/img1.png',
    },
    { id: 'img-2', label: '详情图', gradientFrom: '#ffecd2', gradientTo: '#fcb69f' },
    {
      id: 'img-3',
      label: '氛围图',
      gradientFrom: '#ff9a9e',
      gradientTo: '#fecfef',
      url: 'https://example.com/img3.png',
    },
  ],
};

const MOCK_VIDEO_GENERATION: VideoGenerationResult = {
  title: '夏日清透妆教程',
  duration: '00:15',
  prompt: 'test prompt',
  params: { model: 'veo-2.0', mode: 'text2video' },
  status: 'completed',
  videoUrl: 'https://example.com/video.mp4',
};

const MOCK_VIDEO_GENERATION_FAILED: VideoGenerationResult = {
  title: '夏日清透妆教程',
  duration: '00:00',
  prompt: 'test prompt',
  params: { model: 'veo-2.0', mode: 'text2video' },
  status: 'failed',
  error: 'API 不支持视频生成',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_BRAND_INPUT = {
  brandName: '测试品牌',
  industry: 'beauty',
  platforms: ['xhs', 'douyin'],
  competitors: '完美日记, 花西子',
};

function resetStore() {
  useMediaStudioStore.setState({
    activeView: 'dashboard',
    contentFilter: 'all',
    contentPlatformFilter: 'all',
    workflowFilter: 'all',
    studioStep: 0,
    stepStatuses: { 0: 'pending', 1: 'pending', 2: 'pending', 3: 'pending', 4: 'pending' },
    brandAnalysisLog: [],
    brandAnalysisResult: null,
    brandAnalysisRunning: false,
    textGenLog: [],
    textGenResult: null,
    textGenRunning: false,
    imageGenLog: [],
    imageGenResult: null,
    imageGenRunning: false,
    videoGenLog: [],
    videoGenResult: null,
    videoGenRunning: false,
    publishLog: [],
    publishComplete: false,
    publishRunning: false,
    crmTab: 'dm',
    operationMode: 'auto',
    _runId: 0,
  });
}

/**
 * Configure `window.electron.ipcRenderer.invoke` to return appropriate
 * mock responses for each studio IPC channel.
 */
function mockIpcSuccess(overrides?: {
  brandAnalysis?: BrandAnalysisResult;
  textGeneration?: TextGenerationResult;
  imageGeneration?: ImageGenerationResult;
  videoGeneration?: VideoGenerationResult;
  publishSuccess?: boolean;
}) {
  const invoke = window.electron.ipcRenderer.invoke as ReturnType<typeof vi.fn>;
  invoke.mockImplementation(async (channel: string, ..._args: unknown[]) => {
    switch (channel) {
      case 'studio:brand-analysis':
        return { success: true, result: overrides?.brandAnalysis ?? MOCK_BRAND_ANALYSIS };
      case 'studio:text-generation':
        return { success: true, result: overrides?.textGeneration ?? MOCK_TEXT_GENERATION };
      case 'studio:image-generation':
        return { success: true, result: overrides?.imageGeneration ?? MOCK_IMAGE_GENERATION };
      case 'studio:video-generation':
        return { success: true, result: overrides?.videoGeneration ?? MOCK_VIDEO_GENERATION };
      case 'studio:publish':
        return {
          success: true,
          result: { success: overrides?.publishSuccess ?? true },
        };
      case 'studio:cancel':
        return { success: true };
      default:
        return { success: false, error: `Unmocked channel: ${channel}` };
    }
  });
}

function mockIpcFailure(channel: string, errorMsg: string) {
  const invoke = window.electron.ipcRenderer.invoke as ReturnType<typeof vi.fn>;
  const original = invoke.getMockImplementation();
  invoke.mockImplementation(async (ch: string, ...args: unknown[]) => {
    if (ch === channel) {
      return { success: false, error: errorMsg };
    }
    if (original) return original(ch, ...args);
    return { success: false, error: 'Unmocked' };
  });
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

describe('Media Studio Store — Navigation', () => {
  beforeEach(resetStore);

  it('should default to dashboard view', () => {
    expect(useMediaStudioStore.getState().activeView).toBe('dashboard');
  });

  it('should switch active view', () => {
    const { setActiveView } = useMediaStudioStore.getState();
    setActiveView('studio');
    expect(useMediaStudioStore.getState().activeView).toBe('studio');

    setActiveView('crm');
    expect(useMediaStudioStore.getState().activeView).toBe('crm');
  });
});

// ---------------------------------------------------------------------------
// Mock Data Integrity
// ---------------------------------------------------------------------------

describe('Media Studio Store — Mock Data', () => {
  beforeEach(resetStore);

  it('should have 8 team members', () => {
    expect(useMediaStudioStore.getState().teamMembers).toHaveLength(8);
  });

  it('should have dashboard stats with positive values', () => {
    const { stats } = useMediaStudioStore.getState();
    expect(stats.contentOutput).toBeGreaterThan(0);
    expect(stats.pendingApproval).toBeGreaterThan(0);
    expect(stats.publishedToday).toBeGreaterThan(0);
    expect(stats.newFollowers).toBeGreaterThan(0);
  });

  it('should have platform metrics for 3 platforms', () => {
    expect(useMediaStudioStore.getState().platformMetrics).toHaveLength(3);
  });

  it('should have timeline events', () => {
    expect(useMediaStudioStore.getState().timeline.length).toBeGreaterThan(0);
  });

  it('should have approval items', () => {
    expect(useMediaStudioStore.getState().approvals.length).toBeGreaterThan(0);
  });

  it('should have content items', () => {
    expect(useMediaStudioStore.getState().contentItems.length).toBeGreaterThan(0);
  });

  it('should have workflow tasks', () => {
    expect(useMediaStudioStore.getState().workflowTasks.length).toBeGreaterThan(0);
  });

  it('should have CRM data (DMs, comments, leads)', () => {
    const state = useMediaStudioStore.getState();
    expect(state.dmConversations.length).toBeGreaterThan(0);
    expect(state.comments.length).toBeGreaterThan(0);
    expect(state.leads.length).toBeGreaterThan(0);
  });

  it('should have a daily report', () => {
    const { dailyReport } = useMediaStudioStore.getState();
    expect(dailyReport.date).toBeDefined();
    expect(dailyReport.contentProduced).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Content Library Filters
// ---------------------------------------------------------------------------

describe('Media Studio Store — Content Filters', () => {
  beforeEach(resetStore);

  it('should default content filter to all', () => {
    expect(useMediaStudioStore.getState().contentFilter).toBe('all');
    expect(useMediaStudioStore.getState().contentPlatformFilter).toBe('all');
  });

  it('should update content status filter', () => {
    useMediaStudioStore.getState().setContentFilter('draft');
    expect(useMediaStudioStore.getState().contentFilter).toBe('draft');
  });

  it('should update content platform filter', () => {
    useMediaStudioStore.getState().setContentPlatformFilter('xhs');
    expect(useMediaStudioStore.getState().contentPlatformFilter).toBe('xhs');
  });
});

// ---------------------------------------------------------------------------
// Workflow Filters
// ---------------------------------------------------------------------------

describe('Media Studio Store — Workflow Filters', () => {
  beforeEach(resetStore);

  it('should default workflow filter to all', () => {
    expect(useMediaStudioStore.getState().workflowFilter).toBe('all');
  });

  it('should update workflow filter', () => {
    useMediaStudioStore.getState().setWorkflowFilter('douyin');
    expect(useMediaStudioStore.getState().workflowFilter).toBe('douyin');
  });
});

// ---------------------------------------------------------------------------
// Studio Pipeline — IPC-backed
// ---------------------------------------------------------------------------

describe('Media Studio Store — Studio Pipeline', () => {
  beforeEach(() => {
    resetStore();
    mockIpcSuccess();
  });

  it('should start at step 0 with all pending', () => {
    const state = useMediaStudioStore.getState();
    expect(state.studioStep).toBe(0);
    Object.values(state.stepStatuses).forEach((s) => expect(s).toBe('pending'));
  });

  it('should switch studio step', () => {
    useMediaStudioStore.getState().setStudioStep(3);
    expect(useMediaStudioStore.getState().studioStep).toBe(3);
  });

  // -- Step 0: Brand Analysis --

  it('should run brand analysis and produce result', async () => {
    await useMediaStudioStore.getState().startBrandAnalysis(DEFAULT_BRAND_INPUT);
    const state = useMediaStudioStore.getState();

    expect(state.brandAnalysisRunning).toBe(false);
    expect(state.brandAnalysisResult).not.toBeNull();
    expect(state.brandAnalysisResult!.competitors).toHaveLength(2);
    expect(state.brandAnalysisResult!.strategy.positioning).toBeDefined();
    expect(state.stepStatuses[0]).toBe('done');
  });

  it('should invoke studio:brand-analysis IPC with correct params', async () => {
    await useMediaStudioStore.getState().startBrandAnalysis(DEFAULT_BRAND_INPUT);

    const invoke = window.electron.ipcRenderer.invoke as ReturnType<typeof vi.fn>;
    expect(invoke).toHaveBeenCalledWith('studio:brand-analysis', DEFAULT_BRAND_INPUT);
  });

  it('should handle brand analysis IPC failure', async () => {
    mockIpcFailure('studio:brand-analysis', 'Engine not initialized');

    await useMediaStudioStore.getState().startBrandAnalysis(DEFAULT_BRAND_INPUT);
    const state = useMediaStudioStore.getState();

    expect(state.brandAnalysisRunning).toBe(false);
    expect(state.brandAnalysisResult).toBeNull();
    expect(state.stepStatuses[0]).toBe('pending');
    expect(state.brandAnalysisLog.some((l) => l.type === 'error')).toBe(true);
  });

  // -- Step 1: Text Generation --

  it('should run text generation after brand analysis', async () => {
    // Run brand analysis first to populate prerequisite
    await useMediaStudioStore.getState().startBrandAnalysis(DEFAULT_BRAND_INPUT);
    expect(useMediaStudioStore.getState().brandAnalysisResult).not.toBeNull();

    await useMediaStudioStore.getState().startTextGeneration();
    const state = useMediaStudioStore.getState();

    expect(state.textGenRunning).toBe(false);
    expect(state.textGenResult).not.toBeNull();
    expect(state.textGenResult!.title).toBeDefined();
    expect(state.stepStatuses[1]).toBe('done');
  });

  it('should not run text generation without brand analysis result', async () => {
    // No brand analysis result
    await useMediaStudioStore.getState().startTextGeneration();
    const state = useMediaStudioStore.getState();

    // Should early-return without changing state
    expect(state.textGenRunning).toBe(false);
    expect(state.textGenResult).toBeNull();
    expect(state.stepStatuses[1]).toBe('pending');
  });

  it('should handle text generation IPC failure', async () => {
    await useMediaStudioStore.getState().startBrandAnalysis(DEFAULT_BRAND_INPUT);
    mockIpcFailure('studio:text-generation', 'LLM timeout');

    await useMediaStudioStore.getState().startTextGeneration();
    const state = useMediaStudioStore.getState();

    expect(state.textGenRunning).toBe(false);
    expect(state.textGenResult).toBeNull();
    expect(state.stepStatuses[1]).toBe('pending');
    expect(state.textGenLog.some((l) => l.type === 'error')).toBe(true);
  });

  // -- Step 2: Image Generation --

  it('should run image generation after text generation', async () => {
    await useMediaStudioStore.getState().startBrandAnalysis(DEFAULT_BRAND_INPUT);
    await useMediaStudioStore.getState().startTextGeneration();

    await useMediaStudioStore.getState().startImageGeneration();
    const state = useMediaStudioStore.getState();

    expect(state.imageGenRunning).toBe(false);
    expect(state.imageGenResult).not.toBeNull();
    expect(state.imageGenResult!.images.length).toBeGreaterThan(0);
    expect(state.stepStatuses[2]).toBe('done');
  });

  it('should not run image generation without text result', async () => {
    await useMediaStudioStore.getState().startImageGeneration();
    const state = useMediaStudioStore.getState();

    expect(state.imageGenRunning).toBe(false);
    expect(state.imageGenResult).toBeNull();
    expect(state.stepStatuses[2]).toBe('pending');
  });

  it('should preserve filePath and url in image results', async () => {
    await useMediaStudioStore.getState().startBrandAnalysis(DEFAULT_BRAND_INPUT);
    await useMediaStudioStore.getState().startTextGeneration();
    await useMediaStudioStore.getState().startImageGeneration();

    const result = useMediaStudioStore.getState().imageGenResult!;
    expect(result.images[0].filePath).toBe('/tmp/img1.png');
    expect(result.images[2].url).toBe('https://example.com/img3.png');
    // All images should keep gradient fallbacks
    result.images.forEach((img) => {
      expect(img.gradientFrom).toBeDefined();
      expect(img.gradientTo).toBeDefined();
    });
  });

  // -- Step 3: Video Generation --

  it('should run video generation after image generation', async () => {
    await useMediaStudioStore.getState().startBrandAnalysis(DEFAULT_BRAND_INPUT);
    await useMediaStudioStore.getState().startTextGeneration();
    await useMediaStudioStore.getState().startImageGeneration();

    await useMediaStudioStore.getState().startVideoGeneration();
    const state = useMediaStudioStore.getState();

    expect(state.videoGenRunning).toBe(false);
    expect(state.videoGenResult).not.toBeNull();
    expect(state.videoGenResult!.status).toBe('completed');
    expect(state.videoGenResult!.videoUrl).toBe('https://example.com/video.mp4');
    expect(state.stepStatuses[3]).toBe('done');
  });

  it('should not run video generation without prerequisites', async () => {
    await useMediaStudioStore.getState().startVideoGeneration();
    const state = useMediaStudioStore.getState();

    expect(state.videoGenRunning).toBe(false);
    expect(state.videoGenResult).toBeNull();
    expect(state.stepStatuses[3]).toBe('pending');
  });

  it('should handle video generation with failed status gracefully', async () => {
    mockIpcSuccess({ videoGeneration: MOCK_VIDEO_GENERATION_FAILED });

    await useMediaStudioStore.getState().startBrandAnalysis(DEFAULT_BRAND_INPUT);
    await useMediaStudioStore.getState().startTextGeneration();
    await useMediaStudioStore.getState().startImageGeneration();
    await useMediaStudioStore.getState().startVideoGeneration();

    const state = useMediaStudioStore.getState();
    expect(state.videoGenRunning).toBe(false);
    expect(state.videoGenResult).not.toBeNull();
    expect(state.videoGenResult!.status).toBe('failed');
    expect(state.videoGenResult!.error).toBeDefined();
    // Even failed results mark step as done (user can skip)
    expect(state.stepStatuses[3]).toBe('done');
  });

  // -- Step 4: Publish --

  it('should run publish after image generation', async () => {
    await useMediaStudioStore.getState().startBrandAnalysis(DEFAULT_BRAND_INPUT);
    await useMediaStudioStore.getState().startTextGeneration();
    await useMediaStudioStore.getState().startImageGeneration();

    await useMediaStudioStore.getState().startPublish();
    const state = useMediaStudioStore.getState();

    expect(state.publishRunning).toBe(false);
    expect(state.publishComplete).toBe(true);
    expect(state.stepStatuses[4]).toBe('done');
  });

  it('should not run publish without text and image results', async () => {
    await useMediaStudioStore.getState().startPublish();
    const state = useMediaStudioStore.getState();

    expect(state.publishRunning).toBe(false);
    expect(state.publishComplete).toBe(false);
    expect(state.stepStatuses[4]).toBe('pending');
  });

  it('should handle publish IPC failure', async () => {
    await useMediaStudioStore.getState().startBrandAnalysis(DEFAULT_BRAND_INPUT);
    await useMediaStudioStore.getState().startTextGeneration();
    await useMediaStudioStore.getState().startImageGeneration();
    mockIpcFailure('studio:publish', 'publisher-xhs not activated');

    await useMediaStudioStore.getState().startPublish();
    const state = useMediaStudioStore.getState();

    expect(state.publishRunning).toBe(false);
    expect(state.publishComplete).toBe(false);
    expect(state.stepStatuses[4]).toBe('pending');
    expect(state.publishLog.some((l) => l.type === 'error')).toBe(true);
  });

  // -- Full Pipeline --

  it('should run full pipeline end-to-end (5 steps)', async () => {
    await useMediaStudioStore.getState().startBrandAnalysis(DEFAULT_BRAND_INPUT);
    expect(useMediaStudioStore.getState().stepStatuses[0]).toBe('done');

    await useMediaStudioStore.getState().startTextGeneration();
    expect(useMediaStudioStore.getState().stepStatuses[1]).toBe('done');

    await useMediaStudioStore.getState().startImageGeneration();
    expect(useMediaStudioStore.getState().stepStatuses[2]).toBe('done');

    await useMediaStudioStore.getState().startVideoGeneration();
    expect(useMediaStudioStore.getState().stepStatuses[3]).toBe('done');

    await useMediaStudioStore.getState().startPublish();
    const final = useMediaStudioStore.getState();
    expect(final.stepStatuses[4]).toBe('done');
    expect(final.publishComplete).toBe(true);

    // All 5 steps done
    Object.values(final.stepStatuses).forEach((s) => expect(s).toBe('done'));
  });

  it('should invoke IPC channels in correct order during full pipeline', async () => {
    const invoke = window.electron.ipcRenderer.invoke as ReturnType<typeof vi.fn>;

    await useMediaStudioStore.getState().startBrandAnalysis(DEFAULT_BRAND_INPUT);
    await useMediaStudioStore.getState().startTextGeneration();
    await useMediaStudioStore.getState().startImageGeneration();
    await useMediaStudioStore.getState().startVideoGeneration();
    await useMediaStudioStore.getState().startPublish();

    const channels = invoke.mock.calls.map((call: unknown[]) => call[0]);
    expect(channels).toEqual([
      'studio:brand-analysis',
      'studio:text-generation',
      'studio:image-generation',
      'studio:video-generation',
      'studio:publish',
    ]);
  });

  // -- Cancel & Reset --

  it('should cancel studio and reset running flags', async () => {
    // Simulate a running state
    useMediaStudioStore.setState({ brandAnalysisRunning: true });

    await useMediaStudioStore.getState().cancelStudio();
    const state = useMediaStudioStore.getState();

    expect(state.brandAnalysisRunning).toBe(false);
    expect(state.textGenRunning).toBe(false);
    expect(state.imageGenRunning).toBe(false);
    expect(state.videoGenRunning).toBe(false);
    expect(state.publishRunning).toBe(false);

    const invoke = window.electron.ipcRenderer.invoke as ReturnType<typeof vi.fn>;
    expect(invoke).toHaveBeenCalledWith('studio:cancel');
  });

  it('should reset studio to initial state', async () => {
    // Run brand analysis first
    await useMediaStudioStore.getState().startBrandAnalysis(DEFAULT_BRAND_INPUT);
    expect(useMediaStudioStore.getState().stepStatuses[0]).toBe('done');

    // Reset
    useMediaStudioStore.getState().resetStudio();
    const state = useMediaStudioStore.getState();

    expect(state.studioStep).toBe(0);
    expect(state.brandAnalysisResult).toBeNull();
    expect(state.brandAnalysisLog).toHaveLength(0);
    expect(state.brandAnalysisRunning).toBe(false);
    expect(state.textGenResult).toBeNull();
    expect(state.imageGenResult).toBeNull();
    expect(state.videoGenResult).toBeNull();
    expect(state.publishComplete).toBe(false);
    Object.values(state.stepStatuses).forEach((s) => expect(s).toBe('pending'));
  });

  it('should reset studio and invoke studio:cancel', () => {
    useMediaStudioStore.getState().resetStudio();

    const invoke = window.electron.ipcRenderer.invoke as ReturnType<typeof vi.fn>;
    expect(invoke).toHaveBeenCalledWith('studio:cancel');
  });

  // -- Cancellation via _runId --

  it('should discard stale results when _runId changes mid-flight', async () => {
    // Start brand analysis
    const promise = useMediaStudioStore.getState().startBrandAnalysis(DEFAULT_BRAND_INPUT);

    // Increment _runId to simulate cancellation before IPC returns
    // We need to do this synchronously while the promise is pending
    // Since our mock resolves immediately, we instead test the reset path
    useMediaStudioStore.setState({ _runId: 999 });

    await promise;

    // Result should be discarded because _runId changed
    const state = useMediaStudioStore.getState();
    expect(state.brandAnalysisResult).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// CRM
// ---------------------------------------------------------------------------

describe('Media Studio Store — CRM', () => {
  beforeEach(resetStore);

  it('should default CRM tab to dm', () => {
    expect(useMediaStudioStore.getState().crmTab).toBe('dm');
  });

  it('should switch CRM tabs', () => {
    useMediaStudioStore.getState().setCrmTab('comments');
    expect(useMediaStudioStore.getState().crmTab).toBe('comments');

    useMediaStudioStore.getState().setCrmTab('leads');
    expect(useMediaStudioStore.getState().crmTab).toBe('leads');
  });
});

// ---------------------------------------------------------------------------
// Operation Mode
// ---------------------------------------------------------------------------

describe('Media Studio Store — Operation Mode', () => {
  beforeEach(resetStore);

  it('should default to auto mode', () => {
    expect(useMediaStudioStore.getState().operationMode).toBe('auto');
  });

  it('should toggle between auto and manual', () => {
    useMediaStudioStore.getState().toggleOperationMode();
    expect(useMediaStudioStore.getState().operationMode).toBe('manual');

    useMediaStudioStore.getState().toggleOperationMode();
    expect(useMediaStudioStore.getState().operationMode).toBe('auto');
  });
});
