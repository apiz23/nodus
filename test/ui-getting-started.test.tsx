import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GettingStartedGuide } from '../ui/src/GettingStartedGuide.js';

describe('getting-started guide', () => {
  it('is a compact, keyboard-operable set of actions for existing workspace routes', () => {
    const markup = renderToStaticMarkup(createElement(GettingStartedGuide, { onNavigate: () => {}, onDismiss: () => {} }));
    expect(markup).toContain('aria-labelledby="getting-started-title"');
    expect(markup).toContain('Create and organize notes');
    expect(markup).toContain('Find a note');
    expect(markup).toContain('Connect ideas');
    expect(markup).toContain('Explore the knowledge graph');
    expect(markup).toContain('Work with structured data');
    expect(markup).toContain('Go to notes');
    expect(markup).toContain('Open Discovery');
    expect(markup).toContain('Open graph');
    expect(markup).toContain('Open databases');
    expect(markup).toContain('aria-label="Dismiss getting started guide"');
    expect(markup).toContain('>Got it</button>');
    expect(markup).not.toContain('role="dialog"');
  });
});
