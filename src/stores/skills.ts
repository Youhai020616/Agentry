/**
 * Skills State Store
 * Manages skill/plugin state backed by EmployeeManager via `skill:listAll` IPC.
 */
import { create } from 'zustand';
import type { Skill, MarketplaceSkill } from '../types/skill';
import type { SkillPackInfo } from '@/types/manifest';

interface SkillsState {
  /** Raw data from skill:listAll */
  skillPacks: SkillPackInfo[];
  /** Backward-compatible Skill[] derived from skillPacks */
  skills: Skill[];
  searchResults: MarketplaceSkill[];
  loading: boolean;
  searching: boolean;
  searchError: string | null;
  installing: Record<string, boolean>; // slug -> boolean
  error: string | null;

  // Actions
  fetchSkills: () => Promise<void>;
  scanAndRefresh: () => Promise<void>;
  searchSkills: (query: string) => Promise<void>;
  installSkill: (slug: string, version?: string) => Promise<void>;
  uninstallSkill: (slug: string) => Promise<void>;
  setSkills: (skills: Skill[]) => void;
  updateSkill: (skillId: string, updates: Partial<Skill>) => void;
}

/**
 * Map a SkillPackInfo (from EmployeeManager) to the legacy Skill interface
 * used by existing UI components.
 */
function mapPackToSkill(pack: SkillPackInfo): Skill {
  return {
    id: pack.slug,
    slug: pack.slug,
    name: pack.manifest.employee.roleZh || pack.manifest.employee.role,
    description: pack.manifest.description,
    enabled: pack.status === 'active',
    icon: pack.manifest.employee.avatar,
    version: pack.manifest.version,
    author: pack.manifest.author,
    config: {
      type: pack.manifest.type,
      team: pack.manifest.employee.team,
      pricingModel: pack.manifest.pricing?.model,
    },
    isCore: false,
    isBundled: pack.source === 'builtin',
  };
}

export const useSkillsStore = create<SkillsState>((set, get) => ({
  skillPacks: [],
  skills: [],
  searchResults: [],
  loading: false,
  searching: false,
  searchError: null,
  installing: {},
  error: null,

  fetchSkills: async () => {
    // Only show loading spinner on initial load (empty list)
    if (get().skills.length === 0) {
      set({ loading: true, error: null });
    }
    try {
      const result = (await window.electron.ipcRenderer.invoke('skill:listAll')) as {
        success: boolean;
        result?: SkillPackInfo[];
        error?: string;
      };

      if (result.success && result.result) {
        const packs = result.result;
        const skills = packs.map(mapPackToSkill);
        set({ skillPacks: packs, skills, loading: false, error: null });
      } else {
        // If the call failed but we already have data, keep existing state
        if (get().skills.length > 0) {
          set({ loading: false });
        } else {
          set({
            loading: false,
            error: result.error || 'Failed to fetch skills',
          });
        }
      }
    } catch (error) {
      console.error('Failed to fetch skills:', error);
      set({ loading: false, error: String(error) });
    }
  },

  scanAndRefresh: async () => {
    try {
      await window.electron.ipcRenderer.invoke('employee:scan');
    } catch (error) {
      console.error('employee:scan failed:', error);
    }
    await get().fetchSkills();
  },

  searchSkills: async (query: string) => {
    set({ searching: true, searchError: null });
    try {
      const result = (await window.electron.ipcRenderer.invoke('clawhub:search', {
        query,
      })) as {
        success: boolean;
        results?: MarketplaceSkill[];
        error?: string;
      };
      if (result.success) {
        set({ searchResults: result.results || [] });
      } else {
        throw new Error(result.error || 'Search failed');
      }
    } catch (error) {
      set({ searchError: String(error) });
    } finally {
      set({ searching: false });
    }
  },

  installSkill: async (slug: string, version?: string) => {
    set((state) => ({ installing: { ...state.installing, [slug]: true } }));
    try {
      const result = (await window.electron.ipcRenderer.invoke('clawhub:install', {
        slug,
        version,
      })) as { success: boolean; error?: string };
      if (!result.success) {
        throw new Error(result.error || 'Install failed');
      }
      // Let EmployeeManager discover the new skill, then refresh
      await get().scanAndRefresh();
    } catch (error) {
      console.error('Install error:', error);
      throw error;
    } finally {
      set((state) => {
        const newInstalling = { ...state.installing };
        delete newInstalling[slug];
        return { installing: newInstalling };
      });
    }
  },

  uninstallSkill: async (slug: string) => {
    set((state) => ({ installing: { ...state.installing, [slug]: true } }));
    try {
      const result = (await window.electron.ipcRenderer.invoke('clawhub:uninstall', {
        slug,
      })) as { success: boolean; error?: string };
      if (!result.success) {
        throw new Error(result.error || 'Uninstall failed');
      }
      // Let EmployeeManager update its state, then refresh
      await get().scanAndRefresh();
    } catch (error) {
      console.error('Uninstall error:', error);
      throw error;
    } finally {
      set((state) => {
        const newInstalling = { ...state.installing };
        delete newInstalling[slug];
        return { installing: newInstalling };
      });
    }
  },

  setSkills: (skills) => set({ skills }),

  updateSkill: (skillId, updates) => {
    set((state) => ({
      skills: state.skills.map((skill) =>
        skill.id === skillId ? { ...skill, ...updates } : skill
      ),
    }));
  },
}));
