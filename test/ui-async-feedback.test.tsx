import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FeedbackMessage, LoadingState, EmptyState } from '@/AsyncFeedback';

describe('shared inline feedback', () => {
  it('announces loading without artificial animation', () => {
    const html = renderToStaticMarkup(createElement(LoadingState, null, 'Loading templates…'));
    expect(html).toContain('role="status"');
    expect(html).toContain('Loading templates…');
    expect(html).not.toContain('animate-spin');
  });
  it('shows the supplied error and never invents a retry', () => {
    const html = renderToStaticMarkup(createElement(FeedbackMessage, null, 'The saved revision changed. Reload before editing.'));
    expect(html).toContain('role="alert"');
    expect(html).toContain('Reload before editing');
    expect(html).not.toContain('<button');
  });
  it('disables a caller-approved retry while it is pending', () => {
    const html = renderToStaticMarkup(createElement(FeedbackMessage, { onRetry: () => {}, pending: true }, 'Could not load graph'));
    expect(html).toMatch(/<button[^>]*disabled/);
    expect(html).toContain('Retrying…');
  });
  it('announces successful persistence separately from errors', () => {
    const html = renderToStaticMarkup(createElement(FeedbackMessage, { tone: 'success' }, 'Template library saved.'));
    expect(html).toContain('role="status"');
    expect(html).not.toContain('role="alert"');
  });
  it('keeps contextual guidance and an optional real action in empty states', () => {
    const html = renderToStaticMarkup(createElement(EmptyState, { title: 'No templates yet', action: createElement('button', null, 'Create note template') }, 'Start with a note template.'));
    expect(html).toContain('<h2');
    expect(html).toContain('Start with a note template.');
    expect(html).toContain('<button>Create note template</button>');
  });
});
