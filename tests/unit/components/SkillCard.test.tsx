/**
 * SkillCard Component — Unit Tests
 *
 * Covers rendering, action buttons per packStatus, callbacks, badges, and edge cases.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { SkillCard } from '@/pages/Skills/SkillCard';
import type { Skill } from '@/types/skill';

// ── Mocks ────────────────────────────────────────────────────────────

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => (opts?.defaultValue as string) || key,
  }),
}));

vi.mock('framer-motion', () => ({
  motion: {
    span: 'span',
    div: 'div',
    button: 'button',
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
}));

// ── Test Data ────────────────────────────────────────────────────────

const baseSkill: Skill = {
  id: 'test-skill',
  slug: 'test-skill',
  name: 'Test Researcher',
  description: 'A test research assistant',
  enabled: false,
  icon: '🔬',
  version: '1.0.0',
  author: 'Test Author',
  isCore: false,
  isBundled: true,
};

// ── Helpers ──────────────────────────────────────────────────────────

// ── Tests ────────────────────────────────────────────────────────────

describe('SkillCard', () => {
  // ────────────────────────────────────────────────────────────────────
  // 1. Basic rendering
  // ────────────────────────────────────────────────────────────────────
  describe('renders basic information', () => {
    it('displays skill name, description, and icon', () => {
      render(<SkillCard skill={baseSkill} />);

      expect(screen.getByText('Test Researcher')).toBeInTheDocument();
      expect(screen.getByText('A test research assistant')).toBeInTheDocument();
      expect(screen.getByText('🔬')).toBeInTheDocument();
    });

    it('displays author and version', () => {
      render(<SkillCard skill={baseSkill} />);

      // Author is rendered via i18n key card.by with { author } — our mock
      // returns the defaultValue or the key. The component passes
      // t('card.by', { author: skill.author }) which yields "card.by" from the mock.
      // But the author span itself is inside a <span> so let's check the combined text
      // contains the version string "v1.0.0".
      expect(screen.getByText('v1.0.0')).toBeInTheDocument();
      // Author — the i18n call t('card.by', { author: 'Test Author' }) has no
      // defaultValue, so our mock returns the key "card.by".
      expect(screen.getByText('card.by')).toBeInTheDocument();
    });

    it('shows default icon when skill has no icon', () => {
      const noIconSkill = { ...baseSkill, icon: undefined };
      render(<SkillCard skill={noIconSkill} />);
      // Default fallback icon is 🧩
      expect(screen.getByText('🧩')).toBeInTheDocument();
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // 2. Active status
  // ────────────────────────────────────────────────────────────────────
  describe('packStatus = active', () => {
    it('should show Go to Team button when active', () => {
      const onGoToTeam = vi.fn();
      render(<SkillCard skill={baseSkill} packStatus="active" onGoToTeam={onGoToTeam} />);
      expect(screen.getByText('Go to Team')).toBeInTheDocument();
    });

    it('should call onGoToTeam when clicking Go to Team', () => {
      const onGoToTeam = vi.fn();
      render(<SkillCard skill={baseSkill} packStatus="active" onGoToTeam={onGoToTeam} />);
      fireEvent.click(screen.getByText('Go to Team'));
      expect(onGoToTeam).toHaveBeenCalledTimes(1);
      // Note: onGoToTeam takes no arguments (unlike the old onChat which took skillKey)
    });

    it('should not show Hire or Install buttons when active', () => {
      render(
        <SkillCard
          skill={baseSkill}
          packStatus="active"
          onGoToTeam={() => {}}
          onHire={vi.fn()}
          onInstall={vi.fn()}
        />
      );
      expect(screen.queryByText('Hire')).not.toBeInTheDocument();
      expect(screen.queryByText('card.install')).not.toBeInTheDocument();
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // 3. Hired status
  // ────────────────────────────────────────────────────────────────────
  describe('packStatus = hired', () => {
    it('shows Activate button when onHire is provided', () => {
      const onHire = vi.fn();
      render(<SkillCard skill={baseSkill} packStatus="hired" onHire={onHire} />);

      expect(screen.getByText('Activate')).toBeInTheDocument();
    });

    it('calls onHire with skill.id when Activate button is clicked', () => {
      const onHire = vi.fn();
      render(<SkillCard skill={baseSkill} packStatus="hired" onHire={onHire} />);

      fireEvent.click(screen.getByText('Activate'));
      expect(onHire).toHaveBeenCalledWith('test-skill');
    });

    it('shows Configure button instead of Activate when missingSecrets is true', () => {
      const onHire = vi.fn();
      const onViewDetails = vi.fn();
      render(
        <SkillCard
          skill={baseSkill}
          packStatus="hired"
          onHire={onHire}
          onViewDetails={onViewDetails}
          missingSecrets
        />
      );

      expect(screen.getByText('Configure')).toBeInTheDocument();
      // Activate should NOT be present because missingSecrets takes priority
      expect(screen.queryByText('Activate')).not.toBeInTheDocument();
    });

    it('calls onViewDetails when Configure button is clicked (missingSecrets)', () => {
      const onViewDetails = vi.fn();
      render(
        <SkillCard
          skill={baseSkill}
          packStatus="hired"
          onViewDetails={onViewDetails}
          missingSecrets
        />
      );

      fireEvent.click(screen.getByText('Configure'));
      expect(onViewDetails).toHaveBeenCalledWith('test-skill');
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // 4. Installed status
  // ────────────────────────────────────────────────────────────────────
  describe('packStatus = installed', () => {
    it('shows Hire button when onHire is provided', () => {
      const onHire = vi.fn();
      render(<SkillCard skill={baseSkill} packStatus="installed" onHire={onHire} />);

      expect(screen.getByText('Hire')).toBeInTheDocument();
    });

    it('calls onHire with skill.id when Hire button is clicked', () => {
      const onHire = vi.fn();
      render(<SkillCard skill={baseSkill} packStatus="installed" onHire={onHire} />);

      fireEvent.click(screen.getByText('Hire'));
      expect(onHire).toHaveBeenCalledWith('test-skill');
      expect(onHire).toHaveBeenCalledTimes(1);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // 5. Marketplace card (no packStatus)
  // ────────────────────────────────────────────────────────────────────
  describe('marketplace card (no packStatus)', () => {
    const marketplaceSkill: Skill = {
      ...baseSkill,
      enabled: undefined as unknown as boolean, // signals marketplace card
    };

    it('shows Install button when enabled is undefined and no packStatus', () => {
      const onInstall = vi.fn();
      render(<SkillCard skill={marketplaceSkill} onInstall={onInstall} />);

      expect(screen.getByText('card.install')).toBeInTheDocument();
    });

    it('calls onInstall with skill.id when Install button is clicked', () => {
      const onInstall = vi.fn();
      render(<SkillCard skill={marketplaceSkill} onInstall={onInstall} />);

      fireEvent.click(screen.getByText('card.install'));
      expect(onInstall).toHaveBeenCalledWith('test-skill');
      expect(onInstall).toHaveBeenCalledTimes(1);
    });

    it('does NOT show Install button when enabled is explicitly false', () => {
      const onInstall = vi.fn();
      render(<SkillCard skill={baseSkill} onInstall={onInstall} />);

      // baseSkill has enabled: false — not a marketplace card
      expect(screen.queryByText('card.install')).not.toBeInTheDocument();
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // 6. View Details
  // ────────────────────────────────────────────────────────────────────
  describe('view details', () => {
    it('is always visible when onViewDetails is provided', () => {
      const onViewDetails = vi.fn();

      // Active state
      const { unmount: u1 } = render(
        <SkillCard skill={baseSkill} packStatus="active" onViewDetails={onViewDetails} />
      );
      expect(screen.getByText('card.details')).toBeInTheDocument();
      u1();

      // Hired state
      const { unmount: u2 } = render(
        <SkillCard skill={baseSkill} packStatus="hired" onViewDetails={onViewDetails} />
      );
      expect(screen.getByText('card.details')).toBeInTheDocument();
      u2();

      // No packStatus
      render(<SkillCard skill={baseSkill} onViewDetails={onViewDetails} />);
      expect(screen.getByText('card.details')).toBeInTheDocument();
    });

    it('calls onViewDetails with skill.id when clicked', () => {
      const onViewDetails = vi.fn();
      render(<SkillCard skill={baseSkill} packStatus="installed" onViewDetails={onViewDetails} />);

      fireEvent.click(screen.getByText('card.details'));
      expect(onViewDetails).toHaveBeenCalledWith('test-skill');
      expect(onViewDetails).toHaveBeenCalledTimes(1);
    });

    it('is NOT rendered when onViewDetails is not provided', () => {
      render(<SkillCard skill={baseSkill} packStatus="active" />);
      expect(screen.queryByText('card.details')).not.toBeInTheDocument();
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // 7. Status Badge
  // ────────────────────────────────────────────────────────────────────
  describe('status badge', () => {
    it('shows a green-themed badge when active', () => {
      render(<SkillCard skill={baseSkill} packStatus="active" />);

      // The badge text comes from ts(statusConfig.active.i18nKey, { defaultValue: 'active' })
      // Our mock returns defaultValue → 'active'
      const badge = screen.getByText('active');
      expect(badge).toBeInTheDocument();
      // Verify green styling class is applied
      expect(badge.className).toMatch(/green/);
    });

    it('shows a badge when hired', () => {
      render(<SkillCard skill={baseSkill} packStatus="hired" />);

      const badge = screen.getByText('hired');
      expect(badge).toBeInTheDocument();
    });

    it('shows a badge when installed', () => {
      render(<SkillCard skill={baseSkill} packStatus="installed" />);

      const badge = screen.getByText('installed');
      expect(badge).toBeInTheDocument();
    });

    it('does NOT render a status badge when packStatus is undefined', () => {
      render(<SkillCard skill={baseSkill} />);

      expect(screen.queryByText('active')).not.toBeInTheDocument();
      expect(screen.queryByText('hired')).not.toBeInTheDocument();
      expect(screen.queryByText('installed')).not.toBeInTheDocument();
    });

    it('shows a warning icon when missingSecrets is true', () => {
      render(<SkillCard skill={baseSkill} packStatus="hired" missingSecrets />);

      // The AlertTriangle icon in the top-right badge area has an aria-label
      const warningIcon = screen.getByLabelText('Needs configuration');
      expect(warningIcon).toBeInTheDocument();
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // 8. Uninstall button visibility
  // ────────────────────────────────────────────────────────────────────
  describe('uninstall button', () => {
    it('shows uninstall for non-builtin, non-core skill with packStatus', () => {
      const nonBuiltinSkill: Skill = {
        ...baseSkill,
        isBundled: false,
        isCore: false,
      };
      const onUninstall = vi.fn();
      render(
        <SkillCard skill={nonBuiltinSkill} packStatus="installed" onUninstall={onUninstall} />
      );

      expect(screen.getByText('card.uninstall')).toBeInTheDocument();
    });

    it('hides uninstall for bundled skill', () => {
      const onUninstall = vi.fn();
      render(
        <SkillCard
          skill={{ ...baseSkill, isBundled: true }}
          packStatus="installed"
          onUninstall={onUninstall}
        />
      );

      expect(screen.queryByText('card.uninstall')).not.toBeInTheDocument();
    });

    it('hides uninstall for core skill', () => {
      const onUninstall = vi.fn();
      render(
        <SkillCard
          skill={{ ...baseSkill, isCore: true, isBundled: false }}
          packStatus="installed"
          onUninstall={onUninstall}
        />
      );

      expect(screen.queryByText('card.uninstall')).not.toBeInTheDocument();
    });

    it('hides uninstall when packStatus is undefined', () => {
      const onUninstall = vi.fn();
      render(
        <SkillCard
          skill={{ ...baseSkill, isBundled: false, isCore: false }}
          onUninstall={onUninstall}
        />
      );

      expect(screen.queryByText('card.uninstall')).not.toBeInTheDocument();
    });

    it('calls onUninstall with skill.id when clicked', () => {
      const nonBuiltinSkill: Skill = {
        ...baseSkill,
        isBundled: false,
        isCore: false,
      };
      const onUninstall = vi.fn();
      render(<SkillCard skill={nonBuiltinSkill} packStatus="hired" onUninstall={onUninstall} />);

      fireEvent.click(screen.getByText('card.uninstall'));
      expect(onUninstall).toHaveBeenCalledWith('test-skill');
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // 9. Loading states
  // ────────────────────────────────────────────────────────────────────
  describe('loading states', () => {
    it('disables Hire button when isHiring is true', () => {
      render(<SkillCard skill={baseSkill} packStatus="installed" onHire={vi.fn()} isHiring />);

      const buttons = screen.getAllByRole('button');
      // The hire button should be disabled
      const hireBtn = buttons.find((b) => b.closest('[disabled]') || b.hasAttribute('disabled'));
      expect(hireBtn).toBeDefined();
      expect(hireBtn).toBeDisabled();
    });

    it('disables Install button when isInstalling is true', () => {
      const marketplaceSkill: Skill = {
        ...baseSkill,
        enabled: undefined as unknown as boolean,
      };
      render(<SkillCard skill={marketplaceSkill} onInstall={vi.fn()} isInstalling />);

      const buttons = screen.getAllByRole('button');
      const installBtn = buttons.find((b) => b.hasAttribute('disabled'));
      expect(installBtn).toBeDefined();
      expect(installBtn).toBeDisabled();
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // 10. Metadata badges (skillType, team, pricingTier, rating)
  // ────────────────────────────────────────────────────────────────────
  describe('metadata badges', () => {
    it('renders skill type badge', () => {
      render(<SkillCard skill={baseSkill} skillType="knowledge" />);
      expect(screen.getByText('knowledge')).toBeInTheDocument();
    });

    it('renders team badge', () => {
      render(<SkillCard skill={baseSkill} team="marketing" />);
      expect(screen.getByText('marketing')).toBeInTheDocument();
    });

    it('renders pricing tier badge', () => {
      render(<SkillCard skill={baseSkill} pricingTier="premium" />);
      expect(screen.getByText('premium')).toBeInTheDocument();
    });

    it('renders rating when provided', () => {
      render(<SkillCard skill={baseSkill} rating={4.5} />);
      expect(screen.getByText('4.5')).toBeInTheDocument();
    });

    it('does NOT render rating when it is 0', () => {
      render(<SkillCard skill={baseSkill} rating={0} />);
      expect(screen.queryByText('0.0')).not.toBeInTheDocument();
    });

    it('renders Built-in badge for bundled skills', () => {
      render(<SkillCard skill={{ ...baseSkill, isBundled: true }} />);
      expect(screen.getByText('Built-in')).toBeInTheDocument();
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // 11. Missing secrets warning banner
  // ────────────────────────────────────────────────────────────────────
  describe('missing secrets warning', () => {
    it('shows warning banner for hired status with missingSecrets', () => {
      render(<SkillCard skill={baseSkill} packStatus="hired" missingSecrets />);

      expect(screen.getByText('Missing configuration')).toBeInTheDocument();
    });

    it('shows warning banner for installed status with missingSecrets', () => {
      render(<SkillCard skill={baseSkill} packStatus="installed" missingSecrets />);

      expect(screen.getByText('Missing configuration')).toBeInTheDocument();
    });

    it('does NOT show warning banner for active status with missingSecrets', () => {
      render(<SkillCard skill={baseSkill} packStatus="active" missingSecrets />);

      // The banner text "Missing configuration" should not appear in the card body
      // (the top-right AlertTriangle icon may still be there)
      expect(screen.queryByText('Missing configuration')).not.toBeInTheDocument();
    });
  });
});
