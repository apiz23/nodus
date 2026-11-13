import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { FocusModeBar } from '@/FocusModeBar';
import { GraphView } from '@/GraphView';
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
      databases: [],
      onApplied: () => {},
      sidebarCollapsed: false,
      onToggleSidebar: () => {},
    }));
    expect(html).toMatch(/aria-label="Collapse sidebar"/);
    expect(html).toContain('Templates');
  });
});
