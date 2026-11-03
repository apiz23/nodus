import { useEffect, useState } from 'react';
import { Activity, ArrowDownLeft, ArrowUpRight, LoaderCircle, Network } from 'lucide-react';
import type { UiGraphClusterInsights } from '../../src/ui-server/dto';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { api } from './api';

interface Props {
  clusterId: string;
  isolatedCount: number;
  onSelectNode: (id: string) => void;
  onOpenNote: (id: string) => void;
}

export function GraphClusterInsights({ clusterId, isolatedCount, onSelectNode, onOpenNote }: Props) {
  const [data, setData] = useState<UiGraphClusterInsights | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const isolated = clusterId === '__isolated__';

  useEffect(() => {
    if (isolated) { setData(null); setError(null); setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.graphClusterInsights(clusterId)
      .then((result) => { if (!cancelled) setData(result); })
      .catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : 'Cluster insights could not be loaded.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [clusterId, isolated]);

  if (isolated) {
    return <div className="border-t pt-2 text-xs text-muted-foreground"><span className="font-medium text-foreground">Isolated notes:</span> {isolatedCount} notes with no confirmed incoming or outgoing links. There are no internal or external cluster relationships to measure.</div>;
  }
  if (loading) return <div className="flex items-center gap-2 border-t pt-2 text-xs text-muted-foreground"><LoaderCircle className="size-3.5 animate-spin" />Loading cluster insights…</div>;
  if (error) return <p role="alert" className="border-t pt-2 text-xs text-destructive">{error}</p>;
  if (data === null) return null;

  return (
    <section className="flex flex-col gap-3 border-t pt-3" aria-label="Selected cluster insights">
      <div className="flex flex-wrap items-center gap-2">
        <Activity className="size-3.5 text-muted-foreground" aria-hidden="true" />
        <h2 className="text-xs font-semibold">Cluster insights</h2>
        <Badge variant="secondary">{data.memberCount} {data.memberCount === 1 ? 'note' : 'notes'}</Badge>
        <span className="text-[11px] text-muted-foreground">Measured from confirmed wiki-link edges</span>
      </div>
      <div className="grid grid-cols-2 gap-px border bg-border sm:grid-cols-4">
        <Stat label="Internal links" value={String(data.internalEdges)} />
        <Stat label="Link occurrences" value={String(data.internalLinkOccurrences)} />
        <Stat label="Density" value={`${Math.round(data.density * 1000) / 10}%`} />
        <Stat label="Entry / exit notes" value={`${data.entryNotes.length} / ${data.exitNotes.length}`} />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <h3 className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground"><Network className="size-3" aria-hidden="true" />Most connected in cluster</h3>
          {data.mostConnected.length === 0 ? <p className="mt-1 text-xs text-muted-foreground">No members.</p> : <ul className="mt-1 flex flex-col">
            {data.mostConnected.map((note) => <li key={note.id} className="flex items-center gap-1">
              <Button variant="ghost" size="sm" className="h-auto min-w-0 flex-1 justify-start truncate px-1.5 py-1 text-left text-[11px] font-normal" onClick={() => onSelectNode(note.id)}>{note.title}</Button>
              <span className="font-mono text-[9px] text-muted-foreground">{note.degree}°</span>
              <Button variant="ghost" size="xs" onClick={() => onOpenNote(note.id)}>Open</Button>
            </li>)}
          </ul>}
        </div>
        <div className="grid gap-2">
          <RelationList title="Entry notes" icon={<ArrowDownLeft className="size-3" />} notes={data.entryNotes} onSelectNode={onSelectNode} />
          <RelationList title="Exit notes" icon={<ArrowUpRight className="size-3" />} notes={data.exitNotes} onSelectNode={onSelectNode} />
        </div>
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="bg-background px-3 py-2"><div className="font-heading text-lg font-bold">{value}</div><div className="mt-0.5 text-[10px] text-muted-foreground">{label}</div></div>;
}

function RelationList({ title, icon, notes, onSelectNode }: { title: string; icon: React.ReactNode; notes: UiGraphClusterInsights['entryNotes']; onSelectNode: (id: string) => void }) {
  return <div>
    <h3 className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">{icon}{title}</h3>
    {notes.length === 0 ? <p className="mt-1 text-xs text-muted-foreground">None.</p> : <ul className="mt-1 flex flex-wrap gap-1">
      {notes.map((relation) => <li key={relation.note.id}><Button variant="outline" size="sm" className="h-auto px-1.5 py-0.5 text-[10px] font-normal" onClick={() => onSelectNode(relation.note.id)}>{relation.note.title}{relation.linkCount > 1 ? ` ×${relation.linkCount}` : ''}</Button></li>)}
    </ul>}
  </div>;
}
