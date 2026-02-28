/**
 * Media Studio Store Tests
 * Tests for navigation, filters, pipeline simulation, CRM, and mode toggle.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useMediaStudioStore } from '@/stores/media-studio';

// Speed up pipeline tests by mocking delay
vi.mock('@/lib/utils', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    delay: vi.fn(() => Promise.resolve()),
  };
});

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
// Studio Pipeline
// ---------------------------------------------------------------------------

describe('Media Studio Store — Studio Pipeline', () => {
  beforeEach(resetStore);

  it('should start at step 0 with all pending', () => {
    const state = useMediaStudioStore.getState();
    expect(state.studioStep).toBe(0);
    Object.values(state.stepStatuses).forEach((s) => expect(s).toBe('pending'));
  });

  it('should switch studio step', () => {
    useMediaStudioStore.getState().setStudioStep(3);
    expect(useMediaStudioStore.getState().studioStep).toBe(3);
  });

  it('should run brand analysis and produce result + logs', async () => {
    await useMediaStudioStore.getState().startBrandAnalysis();
    const state = useMediaStudioStore.getState();

    expect(state.brandAnalysisRunning).toBe(false);
    expect(state.brandAnalysisResult).not.toBeNull();
    expect(state.brandAnalysisLog.length).toBeGreaterThan(0);
    expect(state.stepStatuses[0]).toBe('done');
  });

  it('should run text generation and produce result + logs', async () => {
    await useMediaStudioStore.getState().startTextGeneration();
    const state = useMediaStudioStore.getState();

    expect(state.textGenRunning).toBe(false);
    expect(state.textGenResult).not.toBeNull();
    expect(state.textGenResult!.title).toBeDefined();
    expect(state.textGenLog.length).toBeGreaterThan(0);
    expect(state.stepStatuses[1]).toBe('done');
  });

  it('should run image generation and produce result + logs', async () => {
    await useMediaStudioStore.getState().startImageGeneration();
    const state = useMediaStudioStore.getState();

    expect(state.imageGenRunning).toBe(false);
    expect(state.imageGenResult).not.toBeNull();
    expect(state.imageGenResult!.images.length).toBeGreaterThan(0);
    expect(state.imageGenLog.length).toBeGreaterThan(0);
    expect(state.stepStatuses[2]).toBe('done');
  });

  it('should run video generation and produce result + logs', async () => {
    await useMediaStudioStore.getState().startVideoGeneration();
    const state = useMediaStudioStore.getState();

    expect(state.videoGenRunning).toBe(false);
    expect(state.videoGenResult).not.toBeNull();
    expect(state.videoGenResult!.duration).toBeDefined();
    expect(state.videoGenLog.length).toBeGreaterThan(0);
    expect(state.stepStatuses[3]).toBe('done');
  });

  it('should run publish and set publishComplete', async () => {
    await useMediaStudioStore.getState().startPublish();
    const state = useMediaStudioStore.getState();

    expect(state.publishRunning).toBe(false);
    expect(state.publishComplete).toBe(true);
    expect(state.publishLog.length).toBeGreaterThan(0);
    expect(state.stepStatuses[4]).toBe('done');
  });

  it('should run full pipeline end-to-end (5 steps)', async () => {
    const { startBrandAnalysis, startTextGeneration, startImageGeneration, startVideoGeneration, startPublish } =
      useMediaStudioStore.getState();

    await startBrandAnalysis();
    expect(useMediaStudioStore.getState().stepStatuses[0]).toBe('done');

    await startTextGeneration();
    expect(useMediaStudioStore.getState().stepStatuses[1]).toBe('done');

    await startImageGeneration();
    expect(useMediaStudioStore.getState().stepStatuses[2]).toBe('done');

    await startVideoGeneration();
    expect(useMediaStudioStore.getState().stepStatuses[3]).toBe('done');

    await startPublish();
    const final = useMediaStudioStore.getState();
    expect(final.stepStatuses[4]).toBe('done');
    expect(final.publishComplete).toBe(true);

    // All 5 steps done
    Object.values(final.stepStatuses).forEach((s) => expect(s).toBe('done'));
  });

  it('should reset studio to initial state', async () => {
    // Run something first
    await useMediaStudioStore.getState().startBrandAnalysis();
    expect(useMediaStudioStore.getState().stepStatuses[0]).toBe('done');

    // Reset
    useMediaStudioStore.getState().resetStudio();
    const state = useMediaStudioStore.getState();

    expect(state.studioStep).toBe(0);
    expect(state.brandAnalysisResult).toBeNull();
    expect(state.brandAnalysisLog).toHaveLength(0);
    expect(state.brandAnalysisRunning).toBe(false);
    expect(state.textGenResult).toBeNull();
    expect(state.publishComplete).toBe(false);
    Object.values(state.stepStatuses).forEach((s) => expect(s).toBe('pending'));
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
