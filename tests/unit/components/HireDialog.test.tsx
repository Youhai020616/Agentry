/**
 * HireDialog Unit Tests
 *
 * Tests for the HireDialog component which displays available skill packs
 * for hiring as AI employees. Verifies filtering, rendering, badges,
 * missing secrets warnings, and user interactions.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HireDialog } from '@/pages/Employees/HireDialog';
import type { SkillPackInfo } from '@shared/types/manifest';

// ── Mocks ──────────────────────────────────────────────────────────

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback || key,
  }),
}));

const mockScanEmployees = vi.fn().mockResolvedValue(undefined);
const mockFetchEmployees = vi.fn().mockResolvedValue(undefined);

vi.mock('@/stores/employees', () => ({
  useEmployeesStore: (selector: any) => {
    const store = {
      scanEmployees: mockScanEmployees,
      fetchEmployees: mockFetchEmployees,
    };
    return selector(store);
  },
}));

vi.mock('@/pages/Employees/OnboardingWizard', () => ({
  OnboardingWizard: () => null,
}));

// ── Test Data ──────────────────────────────────────────────────────

const mockPacks: SkillPackInfo[] = [
  {
    slug: 'researcher',
    manifest: {
      name: 'researcher',
      version: '1.0.0',
      description: 'Research assistant',
      type: 'knowledge',
      employee: {
        role: 'Researcher',
        roleZh: '研究员',
        avatar: '🔬',
        team: 'research',
        personality: { style: 'analytical', greeting: '' },
      },
      skills: [],
    },
    source: 'builtin',
    skillDir: '/resources/employees/researcher',
    status: 'installed',
    missingSecrets: false,
  },
  {
    slug: 'publisher-xhs',
    manifest: {
      name: 'publisher-xhs',
      version: '1.0.0',
      description: 'XHS publisher',
      type: 'execution',
      employee: {
        role: 'XHS Publisher',
        roleZh: '小红书运营',
        avatar: '📱',
        team: 'marketing',
        personality: { style: 'creative', greeting: '' },
      },
      skills: [],
    },
    source: 'builtin',
    skillDir: '/resources/employees/publisher-xhs',
    status: 'active', // Already activated — should be filtered out
    employeeStatus: 'idle',
    missingSecrets: false,
  },
  {
    slug: 'seo-expert',
    manifest: {
      name: 'seo-expert',
      version: '1.0.0',
      description: 'SEO optimization',
      type: 'knowledge',
      employee: {
        role: 'SEO Expert',
        roleZh: 'SEO 专家',
        avatar: '🔍',
        team: 'marketing',
        personality: { style: 'analytical', greeting: '' },
      },
      skills: [],
      secrets: { API_KEY: { required: true, description: 'API Key' } },
    },
    source: 'marketplace',
    skillDir: '/home/.openclaw/skills/seo-expert',
    status: 'hired',
    missingSecrets: true,
  },
];

// ── Helpers ─────────────────────────────────────────────────────────

const mockInvoke = vi.mocked(window.electron.ipcRenderer.invoke);

function renderDialog(onClose = vi.fn()) {
  return { onClose, ...render(<HireDialog onClose={onClose} />) };
}

function setupDefaultIpc(packs: SkillPackInfo[] = mockPacks) {
  mockInvoke.mockResolvedValue({ success: true, result: packs });
}

// ── Tests ───────────────────────────────────────────────────────────

describe('HireDialog', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockScanEmployees.mockClear();
    mockFetchEmployees.mockClear();
  });

  // 1. Loading state
  describe('loading state', () => {
    it('renders a loading spinner initially before data arrives', () => {
      // Never resolve — keeps the component in loading state
      mockInvoke.mockReturnValue(new Promise(() => {}));
      renderDialog();

      // The Loader2 icon renders as an SVG with the animate-spin class
      const spinner = document.querySelector('.animate-spin');
      expect(spinner).toBeInTheDocument();
    });

    it('shows card list once skill:listAll resolves', async () => {
      setupDefaultIpc();
      renderDialog();

      await waitFor(() => {
        expect(screen.getByText('研究员')).toBeInTheDocument();
      });

      // Spinner should be gone
      const spinner = document.querySelector('.animate-spin');
      expect(spinner).not.toBeInTheDocument();
    });
  });

  // 2. Filters out active packs
  describe('filtering active packs', () => {
    it('excludes packs with status "active" from the rendered list', async () => {
      setupDefaultIpc();
      renderDialog();

      await waitFor(() => {
        expect(screen.getByText('研究员')).toBeInTheDocument();
      });

      // researcher (installed) and seo-expert (hired) should render
      expect(screen.getByText('SEO 专家')).toBeInTheDocument();

      // publisher-xhs (active) should NOT render
      expect(screen.queryByText('小红书运营')).not.toBeInTheDocument();
    });
  });

  // 3. Displays skill pack info
  describe('skill pack info display', () => {
    it('shows avatar, roleZh, team badge, and description', async () => {
      setupDefaultIpc();
      renderDialog();

      await waitFor(() => {
        expect(screen.getByText('研究员')).toBeInTheDocument();
      });

      // Avatar emoji
      expect(screen.getByText('🔬')).toBeInTheDocument();
      expect(screen.getByText('🔍')).toBeInTheDocument();

      // Team badges
      expect(screen.getByText('research')).toBeInTheDocument();
      expect(screen.getByText('marketing')).toBeInTheDocument();

      // Description (shown as "role — description")
      expect(screen.getByText(/Research assistant/)).toBeInTheDocument();
      expect(screen.getByText(/SEO optimization/)).toBeInTheDocument();
    });
  });

  // 4. Source badge
  describe('source badges', () => {
    it('shows source badge text for builtin and marketplace packs', async () => {
      setupDefaultIpc();
      renderDialog();

      await waitFor(() => {
        expect(screen.getByText('研究员')).toBeInTheDocument();
      });

      // The t() mock returns the key itself, so source badges render as i18n keys
      // builtin → t('create.source.builtin'), marketplace → t('create.source.marketplace')
      expect(screen.getByText('create.source.builtin')).toBeInTheDocument();
      expect(screen.getByText('create.source.marketplace')).toBeInTheDocument();
    });
  });

  // 5. Missing secrets warning
  describe('missing secrets warning', () => {
    it('shows a warning for packs with missingSecrets', async () => {
      setupDefaultIpc();
      renderDialog();

      await waitFor(() => {
        expect(screen.getByText('SEO 专家')).toBeInTheDocument();
      });

      // The warning text is t('create.missingSecrets')
      expect(screen.getByText('create.missingSecrets')).toBeInTheDocument();
    });

    it('does NOT show a warning for packs without missingSecrets', async () => {
      setupDefaultIpc();
      renderDialog();

      await waitFor(() => {
        expect(screen.getByText('研究员')).toBeInTheDocument();
      });

      // Only one missingSecrets warning in the whole dialog (for seo-expert)
      const warnings = screen.getAllByText('create.missingSecrets');
      expect(warnings).toHaveLength(1);
    });
  });

  // 6. Hired status badge
  describe('hired status badge', () => {
    it('shows a "Hired" badge for packs with status "hired"', async () => {
      setupDefaultIpc();
      renderDialog();

      await waitFor(() => {
        expect(screen.getByText('SEO 专家')).toBeInTheDocument();
      });

      // t('create.hired') renders as 'create.hired'
      expect(screen.getByText('create.hired')).toBeInTheDocument();
    });
  });

  // 7. Installed status shows Hire button
  describe('installed status hire button', () => {
    it('shows a Hire button for packs with status "installed"', async () => {
      setupDefaultIpc();
      renderDialog();

      await waitFor(() => {
        expect(screen.getByText('研究员')).toBeInTheDocument();
      });

      // t('create.confirm') renders as 'create.confirm' — this is the Hire button label
      // There should be exactly one Hire button (researcher is installed; seo-expert is hired)
      const hireButtons = screen.getAllByText('create.confirm');
      expect(hireButtons).toHaveLength(1);
    });

    it('calls scanEmployees and fetchEmployees when clicking Hire', async () => {
      setupDefaultIpc();
      const user = userEvent.setup();
      renderDialog();

      await waitFor(() => {
        expect(screen.getByText('研究员')).toBeInTheDocument();
      });

      const hireButton = screen.getByText('create.confirm').closest('button')!;
      await user.click(hireButton);

      expect(mockScanEmployees).toHaveBeenCalledTimes(1);
      expect(mockFetchEmployees).toHaveBeenCalledTimes(1);
    });
  });

  // 8. Empty state
  describe('empty state', () => {
    it('shows empty text when all packs are active (all filtered out)', async () => {
      const allActive: SkillPackInfo[] = mockPacks.map((p) => ({
        ...p,
        status: 'active' as const,
        employeeStatus: 'idle',
      }));
      mockInvoke.mockResolvedValue({ success: true, result: allActive });
      renderDialog();

      await waitFor(() => {
        expect(screen.getByText('create.empty')).toBeInTheDocument();
      });
    });

    it('shows empty text when skill:listAll returns an empty array', async () => {
      mockInvoke.mockResolvedValue({ success: true, result: [] });
      renderDialog();

      await waitFor(() => {
        expect(screen.getByText('create.empty')).toBeInTheDocument();
      });
    });
  });

  // 9. Close interactions
  describe('close behavior', () => {
    it('calls onClose when clicking the close (X) button', async () => {
      setupDefaultIpc();
      const user = userEvent.setup();
      const { onClose } = renderDialog();

      await waitFor(() => {
        expect(screen.getByText('研究员')).toBeInTheDocument();
      });

      // The cancel button in the footer renders t('create.cancel')
      const cancelButton = screen.getByText('create.cancel');
      await user.click(cancelButton);

      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('calls onClose when clicking the backdrop', async () => {
      setupDefaultIpc();
      const user = userEvent.setup();
      const { onClose } = renderDialog();

      await waitFor(() => {
        expect(screen.getByText('研究员')).toBeInTheDocument();
      });

      // The backdrop is the div with bg-black/60
      const backdrop = document.querySelector('.bg-black\\/60') as HTMLElement;
      expect(backdrop).toBeInTheDocument();
      await user.click(backdrop);

      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('calls onClose when pressing Escape', async () => {
      setupDefaultIpc();
      const user = userEvent.setup();
      const { onClose } = renderDialog();

      await waitFor(() => {
        expect(screen.getByText('研究员')).toBeInTheDocument();
      });

      await user.keyboard('{Escape}');

      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  // Edge case: IPC failure
  describe('error handling', () => {
    it('shows empty state when skill:listAll fails', async () => {
      mockInvoke.mockRejectedValue(new Error('IPC error'));
      renderDialog();

      await waitFor(() => {
        expect(screen.getByText('create.empty')).toBeInTheDocument();
      });
    });

    it('shows empty state when skill:listAll returns success: false', async () => {
      mockInvoke.mockResolvedValue({ success: false, error: 'something went wrong' });
      renderDialog();

      await waitFor(() => {
        expect(screen.getByText('create.empty')).toBeInTheDocument();
      });
    });
  });
});
