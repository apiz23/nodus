import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { FocusModeBar } from '@/FocusModeBar';
import { GraphView } from '@/GraphView';
import { ConflictsView } from '@/ConflictsView';
import { conflictLabel } from '@/conflictPresentation';
import { SIDEBAR_SECTIONS } from '@/workspacePreferences';
import { TemplatesView } from '@/TemplatesView';

function render(node: React.ReactNode): string {
  return renderToStaticMarkup(createElement(TooltipProvider, null, node));
}

describe('focus mode recovery', () => {
  it('renders an obvious exit control with a real button and accessible name', () => {
    const html = render(createElement(FocusModeBar, { onExit: () => {} }));
    expect(html).toContain('Focus mode is on');
    expect(html).toMatch(/<button[^>]*aria-label="Exit focus mode"/);
    expect(html).toContain('Exit focus mode');
    // Desktop-only: hidden below the md breakpoint so it never competes with
    // the mobile top bar, which already exits focus mode.
    expect(html).toContain('hidden');
    expect(html).toContain('md:flex');
  });
});

describe('graph sidebar expansion', () => {
  it('renders the shared sidebar toggle in the graph header', () => {
    const html = render(createElement(GraphView, {
      revision: 0,
      initialNoteId: null,
      vaultKey: '/vault',
      onOpenNote: () => {},
      sidebarCollapsed: true,
      onToggleSidebar: () => {},
    }));
    expect(html).toMatch(/aria-label="Expand sidebar"/);
    expect(html).toContain('Local graph');
  });
});

describe('templates sidebar expansion', () => {
  it('renders the shared sidebar toggle in the templates header', () => {
    const html = render(createElement(TemplatesView, {
      vaultPath: '/vault',
      databases: [],
      onApplied: () => {},
      sidebarCollapsed: false,
      onToggleSidebar: () => {},
    }));
    expect(html).toMatch(/aria-label="Collapse sidebar"/);
    expect(html).toContain('Templates');
  });
});

describe('conflicts navigation and presentation', () => {
  it('uses the shared sidebar recovery control', () => {
    const html = render(createElement(ConflictsView, { onOpenDocument: () => {}, sidebarCollapsed: true, onToggleSidebar: () => {} }));
    expect(html).toContain('aria-label="Expand sidebar"');
  });
  it('keeps shortcut help claims bounded to supported actions', () => {
    const help = readFileSync(new URL('../ui/src/ShortcutReferenceDialog.tsx', import.meta.url), 'utf8');
    expect(help).toContain('including Conflicts');
    expect(help).not.toContain('every view');
  });
  it('keeps the recovery entry outside hideable sections', () => {
    expect(SIDEBAR_SECTIONS).not.toContain('conflicts');
  });
  it('labels a merged copy without resolving the original or fabricating recovery', () => {
    expect(conflictLabel({ status: 'open', mergedCopyCount: 1 })).toBe('Open — merged copy created');
    expect(conflictLabel({ status: 'needs-recovery', mergedCopyCount: 1 })).toContain('needs recovery');
    expect(conflictLabel({ status: 'needs-recovery', mergedCopyCount: 0 })).toBe('needs recovery');
  });
});
