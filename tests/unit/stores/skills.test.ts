/**
 * Skills Store Tests
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useSkillsStore } from '@/stores/skills';
import { act } from '@testing-library/react';
import type { SkillPackInfo } from '@/types/manifest';
import type { Skill } from '@/types/skill';

const mockSkillPack: SkillPackInfo = {
  slug: 'researcher',
  manifest: {
    name: 'researcher',
    version: '1.0.0',
    description: 'Research assistant',
    author: 'Agentry',
    type: 'knowledge',
    employee: {
      role: 'Researcher',
      roleZh: '研究员',
      avatar: '🔬',
      team: 'research',
      personality: { style: 'analytical', greeting: 'Hello!' },
    },
    skills: [],
    pricing: { model: 'free' },
  } as SkillPackInfo['manifest'],
  source: 'builtin',
  skillDir: '/resources/employees/researcher',
  status: 'hired',
  missingSecrets: false,
};

const mockSkillPackActive: SkillPackInfo = {
  slug: 'copywriter',
  manifest: {
    name: 'copywriter',
    version: '2.1.0',
    description: 'Marketing copywriter',
    author: 'Community',
    type: 'hybrid',
    employee: {
      role: 'Copywriter',
      roleZh: '',
      avatar: '✍️',
      team: 'marketing',
      personality: { style: 'creative', greeting: 'Hi there!' },
    },
    skills: [],
    pricing: { model: 'premium' },
  } as SkillPackInfo['manifest'],
  source: 'marketplace',
  skillDir: '/marketplace/copywriter',
  status: 'active',
  employeeStatus: 'idle',
  missingSecrets: false,
};

const defaultState = {
  skillPacks: [],
  skills: [],
  searchResults: [],
  loading: false,
  searching: false,
  searchError: null,
  installing: {},
  error: null,
};

describe('useSkillsStore', () => {
  beforeEach(() => {
    useSkillsStore.setState(defaultState);
    vi.clearAllMocks();
  });

  // ── fetchSkills ──────────────────────────────────────────────────

  describe('fetchSkills', () => {
    it('should fetch skills and update state', async () => {
      vi.mocked(window.electron.ipcRenderer.invoke).mockResolvedValueOnce({
        success: true,
        result: [mockSkillPack],
      });

      await act(async () => {
        await useSkillsStore.getState().fetchSkills();
      });

      const state = useSkillsStore.getState();
      expect(state.skillPacks).toHaveLength(1);
      expect(state.skills).toHaveLength(1);
      expect(state.loading).toBe(false);
      expect(state.error).toBeNull();
    });

    it('should map SkillPackInfo to Skill correctly', async () => {
      vi.mocked(window.electron.ipcRenderer.invoke).mockResolvedValueOnce({
        success: true,
        result: [mockSkillPack, mockSkillPackActive],
      });

      await act(async () => {
        await useSkillsStore.getState().fetchSkills();
      });

      const { skills } = useSkillsStore.getState();
      expect(skills).toHaveLength(2);

      // First skill: builtin, hired, has roleZh
      const researcher = skills.find((s) => s.id === 'researcher')!;
      expect(researcher.id).toBe('researcher');
      expect(researcher.slug).toBe('researcher');
      expect(researcher.name).toBe('研究员');
      expect(researcher.description).toBe('Research assistant');
      expect(researcher.enabled).toBe(false); // status = 'hired' → not active
      expect(researcher.icon).toBe('🔬');
      expect(researcher.version).toBe('1.0.0');
      expect(researcher.author).toBe('Agentry');
      expect(researcher.config).toEqual({
        type: 'knowledge',
        team: 'research',
        pricingModel: 'free',
      });
      expect(researcher.isCore).toBe(false);
      expect(researcher.isBundled).toBe(true); // source = 'builtin'

      // Second skill: marketplace, active, empty roleZh falls back to role
      const copywriter = skills.find((s) => s.id === 'copywriter')!;
      expect(copywriter.name).toBe('Copywriter'); // roleZh is empty → fallback to role
      expect(copywriter.enabled).toBe(true); // status = 'active'
      expect(copywriter.isBundled).toBe(false); // source = 'marketplace'
      expect(copywriter.config).toEqual({
        type: 'hybrid',
        team: 'marketing',
        pricingModel: 'premium',
      });
    });

    it('should handle IPC failure with empty skills list', async () => {
      vi.mocked(window.electron.ipcRenderer.invoke).mockResolvedValueOnce({
        success: false,
        error: 'Gateway not connected',
      });

      await act(async () => {
        await useSkillsStore.getState().fetchSkills();
      });

      const state = useSkillsStore.getState();
      expect(state.error).toBe('Gateway not connected');
      expect(state.loading).toBe(false);
      expect(state.skills).toHaveLength(0);
    });

    it('should use default error message when IPC fails without error text', async () => {
      vi.mocked(window.electron.ipcRenderer.invoke).mockResolvedValueOnce({
        success: false,
      });

      await act(async () => {
        await useSkillsStore.getState().fetchSkills();
      });

      expect(useSkillsStore.getState().error).toBe('Failed to fetch skills');
    });

    it('should keep existing skills on IPC failure when data already loaded', async () => {
      // Pre-populate with existing data
      const existingSkill: Skill = {
        id: 'existing',
        name: 'Existing',
        description: 'Already loaded',
        enabled: true,
      };
      useSkillsStore.setState({ skills: [existingSkill] });

      vi.mocked(window.electron.ipcRenderer.invoke).mockResolvedValueOnce({
        success: false,
        error: 'Temporary failure',
      });

      await act(async () => {
        await useSkillsStore.getState().fetchSkills();
      });

      const state = useSkillsStore.getState();
      expect(state.skills).toHaveLength(1);
      expect(state.skills[0].id).toBe('existing');
      expect(state.error).toBeNull(); // error not set when data exists
      expect(state.loading).toBe(false);
    });

    it('should handle thrown exception', async () => {
      vi.mocked(window.electron.ipcRenderer.invoke).mockRejectedValueOnce(
        new Error('IPC failure')
      );

      await act(async () => {
        await useSkillsStore.getState().fetchSkills();
      });

      const state = useSkillsStore.getState();
      expect(state.error).toContain('IPC failure');
      expect(state.loading).toBe(false);
    });

    it('should set loading true only when skills list is empty', async () => {
      let loadingDuringFetch = false;

      vi.mocked(window.electron.ipcRenderer.invoke).mockImplementationOnce(async () => {
        loadingDuringFetch = useSkillsStore.getState().loading;
        return { success: true, result: [] };
      });

      await act(async () => {
        await useSkillsStore.getState().fetchSkills();
      });

      expect(loadingDuringFetch).toBe(true);
    });

    it('should not set loading when skills already exist', async () => {
      const existingSkill: Skill = {
        id: 'existing',
        name: 'Existing',
        description: 'Already loaded',
        enabled: true,
      };
      useSkillsStore.setState({ skills: [existingSkill] });

      let loadingDuringFetch = false;

      vi.mocked(window.electron.ipcRenderer.invoke).mockImplementationOnce(async () => {
        loadingDuringFetch = useSkillsStore.getState().loading;
        return { success: true, result: [mockSkillPack] };
      });

      await act(async () => {
        await useSkillsStore.getState().fetchSkills();
      });

      expect(loadingDuringFetch).toBe(false);
    });
  });

  // ── scanAndRefresh ───────────────────────────────────────────────

  describe('scanAndRefresh', () => {
    it('should call employee:scan then skill:listAll', async () => {
      vi.mocked(window.electron.ipcRenderer.invoke)
        .mockResolvedValueOnce({ success: true }) // employee:scan
        .mockResolvedValueOnce({ success: true, result: [mockSkillPack] }); // skill:listAll

      await act(async () => {
        await useSkillsStore.getState().scanAndRefresh();
      });

      const calls = vi.mocked(window.electron.ipcRenderer.invoke).mock.calls;
      expect(calls[0][0]).toBe('employee:scan');
      expect(calls[1][0]).toBe('skill:listAll');
      expect(useSkillsStore.getState().skills).toHaveLength(1);
    });

    it('should still call fetchSkills when employee:scan fails', async () => {
      vi.mocked(window.electron.ipcRenderer.invoke)
        .mockRejectedValueOnce(new Error('scan error')) // employee:scan
        .mockResolvedValueOnce({ success: true, result: [mockSkillPack] }); // skill:listAll

      await act(async () => {
        await useSkillsStore.getState().scanAndRefresh();
      });

      const calls = vi.mocked(window.electron.ipcRenderer.invoke).mock.calls;
      expect(calls).toHaveLength(2);
      expect(calls[1][0]).toBe('skill:listAll');
      expect(useSkillsStore.getState().skills).toHaveLength(1);
    });
  });

  // ── installSkill ─────────────────────────────────────────────────

  describe('installSkill', () => {
    it('should call clawhub:install with correct params', async () => {
      vi.mocked(window.electron.ipcRenderer.invoke)
        .mockResolvedValueOnce({ success: true }) // clawhub:install
        .mockResolvedValueOnce({ success: true }) // employee:scan
        .mockResolvedValueOnce({ success: true, result: [] }); // skill:listAll

      await act(async () => {
        await useSkillsStore.getState().installSkill('researcher', '1.0.0');
      });

      const firstCall = vi.mocked(window.electron.ipcRenderer.invoke).mock.calls[0];
      expect(firstCall[0]).toBe('clawhub:install');
      expect(firstCall[1]).toEqual({ slug: 'researcher', version: '1.0.0' });
    });

    it('should call scanAndRefresh after successful install', async () => {
      vi.mocked(window.electron.ipcRenderer.invoke)
        .mockResolvedValueOnce({ success: true }) // clawhub:install
        .mockResolvedValueOnce({ success: true }) // employee:scan
        .mockResolvedValueOnce({ success: true, result: [mockSkillPack] }); // skill:listAll

      await act(async () => {
        await useSkillsStore.getState().installSkill('researcher');
      });

      const calls = vi.mocked(window.electron.ipcRenderer.invoke).mock.calls;
      expect(calls).toHaveLength(3);
      expect(calls[0][0]).toBe('clawhub:install');
      expect(calls[1][0]).toBe('employee:scan');
      expect(calls[2][0]).toBe('skill:listAll');
    });

    it('should set installing[slug] to true during install', async () => {
      let installingDuringCall = false;

      vi.mocked(window.electron.ipcRenderer.invoke).mockImplementationOnce(async () => {
        installingDuringCall = useSkillsStore.getState().installing['researcher'] === true;
        return { success: true };
      });
      // scanAndRefresh calls
      vi.mocked(window.electron.ipcRenderer.invoke)
        .mockResolvedValueOnce({ success: true }) // employee:scan
        .mockResolvedValueOnce({ success: true, result: [] }); // skill:listAll

      await act(async () => {
        await useSkillsStore.getState().installSkill('researcher');
      });

      expect(installingDuringCall).toBe(true);
    });

    it('should clear installing[slug] after successful install', async () => {
      vi.mocked(window.electron.ipcRenderer.invoke)
        .mockResolvedValueOnce({ success: true }) // clawhub:install
        .mockResolvedValueOnce({ success: true }) // employee:scan
        .mockResolvedValueOnce({ success: true, result: [] }); // skill:listAll

      await act(async () => {
        await useSkillsStore.getState().installSkill('researcher');
      });

      expect(useSkillsStore.getState().installing['researcher']).toBeUndefined();
    });

    it('should throw error when install fails', async () => {
      vi.mocked(window.electron.ipcRenderer.invoke).mockResolvedValueOnce({
        success: false,
        error: 'Package not found',
      });

      await expect(
        act(async () => {
          await useSkillsStore.getState().installSkill('nonexistent');
        })
      ).rejects.toThrow('Package not found');
    });

    it('should clear installing[slug] even on failure', async () => {
      vi.mocked(window.electron.ipcRenderer.invoke).mockResolvedValueOnce({
        success: false,
        error: 'Install failed',
      });

      try {
        await act(async () => {
          await useSkillsStore.getState().installSkill('researcher');
        });
      } catch {
        // expected
      }

      expect(useSkillsStore.getState().installing['researcher']).toBeUndefined();
    });

    it('should use default error message when install fails without error text', async () => {
      vi.mocked(window.electron.ipcRenderer.invoke).mockResolvedValueOnce({
        success: false,
      });

      await expect(
        act(async () => {
          await useSkillsStore.getState().installSkill('test-skill');
        })
      ).rejects.toThrow('Install failed');
    });
  });

  // ── uninstallSkill ───────────────────────────────────────────────

  describe('uninstallSkill', () => {
    it('should call clawhub:uninstall with correct params', async () => {
      vi.mocked(window.electron.ipcRenderer.invoke)
        .mockResolvedValueOnce({ success: true }) // clawhub:uninstall
        .mockResolvedValueOnce({ success: true }) // employee:scan
        .mockResolvedValueOnce({ success: true, result: [] }); // skill:listAll

      await act(async () => {
        await useSkillsStore.getState().uninstallSkill('researcher');
      });

      const firstCall = vi.mocked(window.electron.ipcRenderer.invoke).mock.calls[0];
      expect(firstCall[0]).toBe('clawhub:uninstall');
      expect(firstCall[1]).toEqual({ slug: 'researcher' });
    });

    it('should call scanAndRefresh after successful uninstall', async () => {
      vi.mocked(window.electron.ipcRenderer.invoke)
        .mockResolvedValueOnce({ success: true }) // clawhub:uninstall
        .mockResolvedValueOnce({ success: true }) // employee:scan
        .mockResolvedValueOnce({ success: true, result: [] }); // skill:listAll

      await act(async () => {
        await useSkillsStore.getState().uninstallSkill('researcher');
      });

      const calls = vi.mocked(window.electron.ipcRenderer.invoke).mock.calls;
      expect(calls).toHaveLength(3);
      expect(calls[0][0]).toBe('clawhub:uninstall');
      expect(calls[1][0]).toBe('employee:scan');
      expect(calls[2][0]).toBe('skill:listAll');
    });

    it('should throw error when uninstall fails', async () => {
      vi.mocked(window.electron.ipcRenderer.invoke).mockResolvedValueOnce({
        success: false,
        error: 'Cannot uninstall builtin skill',
      });

      await expect(
        act(async () => {
          await useSkillsStore.getState().uninstallSkill('researcher');
        })
      ).rejects.toThrow('Cannot uninstall builtin skill');
    });

    it('should clear installing[slug] even on failure', async () => {
      vi.mocked(window.electron.ipcRenderer.invoke).mockResolvedValueOnce({
        success: false,
        error: 'Uninstall failed',
      });

      try {
        await act(async () => {
          await useSkillsStore.getState().uninstallSkill('researcher');
        });
      } catch {
        // expected
      }

      expect(useSkillsStore.getState().installing['researcher']).toBeUndefined();
    });
  });

  // ── searchSkills ─────────────────────────────────────────────────

  describe('searchSkills', () => {
    it('should call clawhub:search with query and set results', async () => {
      const mockResults = [
        { slug: 'seo', name: 'SEO Expert', description: 'SEO skill', version: '1.0.0' },
      ];

      vi.mocked(window.electron.ipcRenderer.invoke).mockResolvedValueOnce({
        success: true,
        results: mockResults,
      });

      await act(async () => {
        await useSkillsStore.getState().searchSkills('seo');
      });

      const firstCall = vi.mocked(window.electron.ipcRenderer.invoke).mock.calls[0];
      expect(firstCall[0]).toBe('clawhub:search');
      expect(firstCall[1]).toEqual({ query: 'seo' });

      const state = useSkillsStore.getState();
      expect(state.searchResults).toHaveLength(1);
      expect(state.searchResults[0].slug).toBe('seo');
      expect(state.searching).toBe(false);
      expect(state.searchError).toBeNull();
    });

    it('should set searchError on failure', async () => {
      vi.mocked(window.electron.ipcRenderer.invoke).mockResolvedValueOnce({
        success: false,
        error: 'Search service unavailable',
      });

      await act(async () => {
        await useSkillsStore.getState().searchSkills('test');
      });

      const state = useSkillsStore.getState();
      expect(state.searchError).toContain('Search service unavailable');
      expect(state.searching).toBe(false);
    });

    it('should set searching to true during search', async () => {
      let searchingDuringCall = false;

      vi.mocked(window.electron.ipcRenderer.invoke).mockImplementationOnce(async () => {
        searchingDuringCall = useSkillsStore.getState().searching;
        return { success: true, results: [] };
      });

      await act(async () => {
        await useSkillsStore.getState().searchSkills('query');
      });

      expect(searchingDuringCall).toBe(true);
      expect(useSkillsStore.getState().searching).toBe(false);
    });

    it('should handle empty results array', async () => {
      vi.mocked(window.electron.ipcRenderer.invoke).mockResolvedValueOnce({
        success: true,
      });

      await act(async () => {
        await useSkillsStore.getState().searchSkills('nonexistent');
      });

      expect(useSkillsStore.getState().searchResults).toEqual([]);
    });

    it('should handle thrown exception during search', async () => {
      vi.mocked(window.electron.ipcRenderer.invoke).mockRejectedValueOnce(
        new Error('Network error')
      );

      await act(async () => {
        await useSkillsStore.getState().searchSkills('test');
      });

      const state = useSkillsStore.getState();
      expect(state.searchError).toContain('Network error');
      expect(state.searching).toBe(false);
    });
  });

  // ── setSkills ────────────────────────────────────────────────────

  describe('setSkills', () => {
    it('should replace skills array', () => {
      const newSkills: Skill[] = [
        { id: 'a', name: 'Skill A', description: 'Desc A', enabled: true },
        { id: 'b', name: 'Skill B', description: 'Desc B', enabled: false },
      ];

      useSkillsStore.getState().setSkills(newSkills);

      const state = useSkillsStore.getState();
      expect(state.skills).toHaveLength(2);
      expect(state.skills[0].id).toBe('a');
      expect(state.skills[1].id).toBe('b');
    });
  });

  // ── updateSkill ──────────────────────────────────────────────────

  describe('updateSkill', () => {
    it('should update a specific skill by id', () => {
      const skills: Skill[] = [
        { id: 'a', name: 'Skill A', description: 'Desc A', enabled: false },
        { id: 'b', name: 'Skill B', description: 'Desc B', enabled: false },
      ];
      useSkillsStore.setState({ skills });

      useSkillsStore.getState().updateSkill('a', { enabled: true, name: 'Updated A' });

      const state = useSkillsStore.getState();
      expect(state.skills[0].enabled).toBe(true);
      expect(state.skills[0].name).toBe('Updated A');
      // Other skill unchanged
      expect(state.skills[1].enabled).toBe(false);
      expect(state.skills[1].name).toBe('Skill B');
    });

    it('should not modify state when skillId does not match', () => {
      const skills: Skill[] = [
        { id: 'a', name: 'Skill A', description: 'Desc A', enabled: false },
      ];
      useSkillsStore.setState({ skills });

      useSkillsStore.getState().updateSkill('nonexistent', { enabled: true });

      expect(useSkillsStore.getState().skills[0].enabled).toBe(false);
    });
  });
});
