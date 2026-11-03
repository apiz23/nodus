import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TasksView } from '@/TasksView';

describe('Tasks view', () => {
  it('renders a labeled loading state before the projection arrives', () => {
    const markup = renderToStaticMarkup(createElement(TasksView, {
      vaultIdentity: '/vault',
      revision: 0,
      onOpenTask: () => {},
      sidebarCollapsed: false,
      onToggleSidebar: () => {},
    }));
    expect(markup).toContain('aria-label="Tasks"');
    expect(markup).toContain('Loading tasks');
    expect(markup).toContain('Tasks come directly from Markdown checkboxes');
  });
});
