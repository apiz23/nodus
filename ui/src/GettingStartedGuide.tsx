import { BookOpen, Check, Database, FileText, Network, Search, Waypoints, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { View } from './types';

interface GettingStartedGuideProps {
  onNavigate: (view: View, focusSearch?: boolean) => void;
  onDismiss: () => void;
}

const steps: { icon: typeof FileText; title: string; detail: string; view: View; action: string; focusSearch?: boolean }[] = [
  { icon: FileText, title: 'Create and organize notes', detail: 'Start with New page in the sidebar. Create folders there to group related notes.', view: 'notes', action: 'Go to notes' },
  { icon: Search, title: 'Find a note', detail: 'Use Search pages in the sidebar to find notes by title, path, or content.', view: 'notes', action: 'Go to search', focusSearch: true },
  { icon: Waypoints, title: 'Connect ideas', detail: 'Type [[ in a note to link another note. Discovery shows backlinks and linked mentions.', view: 'discovery', action: 'Open Discovery' },
  { icon: Network, title: 'Explore the knowledge graph', detail: 'See how notes connect, then open a note directly from the graph.', view: 'graph', action: 'Open graph' },
  { icon: Database, title: 'Work with structured data', detail: 'Create a database, define properties, and use its views to browse notes as rows.', view: 'databases', action: 'Open databases' },
];

export function GettingStartedGuide({ onNavigate, onDismiss }: GettingStartedGuideProps) {
  return (
    <section className="mx-4 my-3 rounded-lg border bg-card p-4 sm:mx-6" aria-labelledby="getting-started-title">
      <div className="flex items-start gap-3">
        <BookOpen className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 id="getting-started-title" className="text-sm font-semibold">Getting started</h1>
              <p className="mt-1 text-xs text-muted-foreground">A quick path from your first note to connected knowledge and structured data.</p>
            </div>
            <Button type="button" variant="ghost" size="icon-sm" aria-label="Dismiss getting started guide" onClick={onDismiss}>
              <X />
            </Button>
          </div>
          <ol className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {steps.map(({ icon: Icon, title, detail, view, action, focusSearch }, index) => (
              <li key={title} className="min-w-0 rounded-md bg-muted/40 p-3">
                <div className="flex items-center gap-2 text-xs font-medium"><span className="text-muted-foreground">{index + 1}.</span><Icon className="size-3.5 text-muted-foreground" aria-hidden="true" />{title}</div>
                <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{detail}</p>
                <Button type="button" variant="link" size="xs" className="mt-1 h-auto px-0" onClick={() => onNavigate(view, focusSearch)}>{action}</Button>
              </li>
            ))}
          </ol>
          <div className="mt-3 flex justify-end">
            <Button type="button" size="sm" onClick={onDismiss}><Check data-icon="inline-start" />Got it</Button>
          </div>
        </div>
      </div>
    </section>
  );
}
