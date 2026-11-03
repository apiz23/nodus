import { useEffect, useRef, useState } from 'react';
import { Activity, ArrowRight, ChevronDown, Compass, Network, PanelLeft, RefreshCw } from 'lucide-react';
import type { UiGraphNoteMetric, UiKnowledgeInsights } from '../../src/ui-server/dto';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDateTime } from './format';
import { api } from './api';

interface Props {
  revision: number;
  onOpenNote: (id: string) => void;
  onOpenDiscovery: () => void;
  onOpenGraph: (noteId?: string) => void;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
}

export function InsightsView({ revision, onOpenNote, onOpenDiscovery, onOpenGraph, sidebarCollapsed, onToggleSidebar }: Props) {
  const [data, setData] = useState<UiKnowledgeInsights | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const request = useRef(0);
  const mounted = useRef(true);

  async function load(refresh = false) {
    const current = ++request.current;
    setLoading(true);
    setError(null);
    try {
      const result = await api.insights(refresh);
      if (mounted.current && current === request.current) setData(result);
    } catch (reason) {
      if (mounted.current && current === request.current) setError(reason instanceof Error ? reason.message : 'Could not load knowledge health.');
    } finally {
      if (mounted.current && current === request.current) setLoading(false);
    }
  }

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => { mounted.current = false; request.current++; };
  }, [revision]);

  const metrics = data?.metrics;

  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label="Knowledge health">
      <header className="flex min-h-12 flex-wrap items-center gap-2 border-b px-4 py-2">
        {sidebarCollapsed ? <Button variant="ghost" size="icon-sm" aria-label="Expand sidebar" onClick={onToggleSidebar}><PanelLeft /></Button> : null}
        <Activity className="size-4 text-muted-foreground" aria-hidden="true" />
        <h1 className="flex-1 text-sm font-medium">Knowledge health</h1>
        <Button variant="ghost" size="sm" disabled={loading} onClick={() => void load(true)}><RefreshCw data-icon="inline-start" />Refresh from disk</Button>
      </header>

      <div className="min-h-0 flex-1 overflow-auto p-4 md:p-8" aria-busy={loading}>
        <div className="mx-auto flex max-w-4xl flex-col gap-8">
          <p className="max-w-[72ch] text-sm leading-6 text-muted-foreground">
            Read-only insights derived from saved Markdown and resolved wiki links. Clusters are connected graph components; they do not imply semantic similarity.
          </p>

          {error ? (
            <div role="alert" className="flex flex-wrap items-center gap-3 border border-destructive/25 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              <span className="min-w-0 flex-1">{error}</span>
              <Button variant="outline" size="sm" onClick={() => void load(true)}>Retry</Button>
            </div>
          ) : null}

          {loading && data === null ? (
            <div className="space-y-3" aria-busy="true">
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-40 w-full" />
              <Skeleton className="h-40 w-full" />
            </div>
          ) : data === null || metrics === undefined ? null : metrics.totalNotes === 0 ? (
            <div className="border border-dashed px-5 py-12 text-center">
              <h2 className="text-sm font-semibold">No notes to analyze yet</h2>
              <p className="mx-auto mt-2 max-w-[48ch] text-sm text-muted-foreground">Create Markdown notes and connect them with wiki links such as [[Note title]]. This dashboard then reports graph health and connected clusters.</p>
            </div>
          ) : (
            <>
              <section aria-labelledby="overview-heading" className="flex flex-col gap-3">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <h2 id="overview-heading" className="text-base font-semibold">Vault overview</h2>
                    <p className="mt-1 text-sm text-muted-foreground">Counts reflect the current saved graph snapshot.</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={() => onOpenGraph()}><Network data-icon="inline-start" />Open local graph</Button>
                    <Button variant="ghost" size="sm" onClick={onOpenDiscovery}><Compass data-icon="inline-start" />Review discovery</Button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-px border bg-border sm:grid-cols-3 lg:grid-cols-5">
                  <Metric label="Notes" value={metrics.totalNotes} onClick={() => onOpenGraph()} />
                  <Metric label="Linked" value={metrics.linkedNotes} onClick={() => onOpenGraph(data.mostConnected[0]?.id)} />
                  <Metric label="Isolated" value={metrics.isolatedNotes} onClick={onOpenDiscovery} />
                  <Metric label="Unresolved links" value={metrics.unresolvedLinks} onClick={onOpenDiscovery} />
                  <Metric label="Ambiguous links" value={metrics.ambiguousLinks} onClick={onOpenDiscovery} />
                </div>
                <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
                  <span>{metrics.componentCount} connected {metrics.componentCount === 1 ? 'component' : 'components'}</span>
                  <span>Largest cluster: {metrics.largestComponentSize}</span>
                  <span>{metrics.selfLinkOccurrences} self-link {metrics.selfLinkOccurrences === 1 ? 'occurrence' : 'occurrences'} excluded from degree</span>
                </div>
              </section>

              <section aria-labelledby="clusters-heading" className="flex flex-col gap-3">
                <div>
                  <h2 id="clusters-heading" className="text-base font-semibold">Knowledge clusters ({data.clusters.length})</h2>
                  <p className="mt-1 text-sm text-muted-foreground">Largest connected groups first. Cluster membership comes from confirmed wiki-link connectivity, not note content.</p>
                </div>
                {data.clusters.map((cluster, index) => (
                  <Collapsible key={cluster.id} defaultOpen={index === 0} className="border-t">
                    <div className="flex items-center gap-2">
                      <CollapsibleTrigger asChild>
                        <Button variant="ghost" className="group h-auto min-w-0 flex-1 justify-start gap-2 px-0 py-3 text-left">
                          <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" aria-hidden="true" />
                          <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-center gap-2">
                              <span className="truncate text-sm font-semibold">{cluster.representative.title}</span>
                              <Badge variant="secondary">{cluster.size} {cluster.size === 1 ? 'note' : 'notes'}</Badge>
                            </span>
                            <span className="mt-0.5 block truncate text-xs text-muted-foreground">{cluster.representative.path}</span>
                          </span>
                        </Button>
                      </CollapsibleTrigger>
                      <Button variant="outline" size="sm" className="shrink-0" onClick={() => onOpenGraph(cluster.representative.id)}>Explore</Button>
                    </div>
                    <CollapsibleContent>
                      <ul className="flex flex-col divide-y border-t">
                        {cluster.members.map((member) => <li key={member.id}>
                          <Button variant="ghost" className="h-auto w-full justify-start gap-3 rounded-none px-2.5 py-2 text-left font-normal" onClick={() => onOpenNote(member.id)}>
                            <span className="min-w-0 flex-1 truncate text-[13px]">{member.title}</span>
                            <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{member.incoming} in · {member.outgoing} out</span>
                          </Button>
                        </li>)}
                      </ul>
                      {cluster.truncated ? <p className="border-t px-2.5 py-2 text-xs text-muted-foreground">Showing the first 20 of {cluster.size} notes. Open the graph to explore the rest.</p> : null}
                    </CollapsibleContent>
                  </Collapsible>
                ))}
              </section>

              <div className="grid gap-8 lg:grid-cols-2">
                <section aria-labelledby="connected-heading" className="flex flex-col gap-3">
                  <div>
                    <h2 id="connected-heading" className="text-base font-semibold">Most connected notes</h2>
                    <p className="mt-1 text-sm text-muted-foreground">Distinct incoming plus outgoing note links. Duplicate link occurrences do not increase degree.</p>
                  </div>
                  {data.mostConnected.length === 0 ? <p className="text-sm text-muted-foreground">No linked notes yet.</p> : <ol className="flex flex-col divide-y border-t">
                    {data.mostConnected.map((note, index) => <li key={note.id}>
                      <Button variant="ghost" className="h-auto w-full justify-start gap-3 rounded-none px-2.5 py-2.5 text-left font-normal" onClick={() => onOpenNote(note.id)}>
                        <span className="w-5 shrink-0 font-mono text-[10px] text-muted-foreground">{index + 1}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-medium">{note.title}</span>
                          <span className="mt-0.5 block truncate text-xs text-muted-foreground">{note.path}</span>
                        </span>
                        <span className="shrink-0 text-right font-mono text-[10px] text-muted-foreground">{note.degree}°<br />{note.incoming} in · {note.outgoing} out</span>
                      </Button>
                    </li>)}
                  </ol>}
                </section>

                <section aria-labelledby="recent-heading" className="flex flex-col gap-3">
                  <div>
                    <h2 id="recent-heading" className="text-base font-semibold">Recently modified</h2>
                    <p className="mt-1 text-sm text-muted-foreground">Most recently saved notes in this vault.</p>
                  </div>
                  {data.recentNotes.length === 0 ? <p className="text-sm text-muted-foreground">No recently modified notes.</p> : <ul className="flex flex-col divide-y border-t">
                    {data.recentNotes.map((note) => <li key={note.id}>
                      <Button variant="ghost" className="h-auto w-full justify-start gap-3 rounded-none px-2.5 py-2.5 text-left font-normal" onClick={() => onOpenNote(note.id)}>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-medium">{note.title}</span>
                          <span className="mt-0.5 block truncate text-xs text-muted-foreground">{note.path}</span>
                        </span>
                        <span className="shrink-0 text-right font-mono text-[10px] text-muted-foreground">{formatDateTime(note.updatedAt)}</span>
                      </Button>
                    </li>)}
                  </ul>}
                </section>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function Metric({ label, value, onClick }: { label: string; value: number; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="group min-w-0 bg-background px-4 py-4 text-left outline-none transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
      <span className="block font-heading text-[clamp(1.5rem,4vw,2rem)] leading-none font-bold tracking-[-0.02em]">{value}</span>
      <span className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">{label}<ArrowRight className="size-3 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true" /></span>
    </button>
  );
}
