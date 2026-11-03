import { useMemo, useState } from 'react';
import { ArrowRight, ChevronDown, LoaderCircle, Route } from 'lucide-react';
import type { GraphNode } from '../../src/links/graph.js';
import type { UiGraphPathResult } from '../../src/ui-server/dto';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { GraphTraversalMode } from '../../src/links/graph-paths.js';
import { api } from './api';

interface Props {
  source: GraphNode;
  nodes: readonly GraphNode[];
  mode: GraphTraversalMode;
  onModeChange: (mode: GraphTraversalMode) => void;
  onSelectNode: (id: string) => void;
}

export function GraphPathExplorer({ source, nodes, mode, onModeChange, onSelectNode }: Props) {
  const [targetId, setTargetId] = useState<string | null>(null);
  const [result, setResult] = useState<UiGraphPathResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const target = targetId === null ? null : nodes.find((node) => node.id === targetId) ?? null;
  const candidates = useMemo(() => nodes.filter((node) => node.id !== source.id).slice(0, 500), [nodes, source.id]);

  async function findPath() {
    if (targetId === null || loading) return;
    setLoading(true);
    setError(null);
    try {
      setResult(await api.graphPath({ from: source.id, to: targetId, mode }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The path could not be computed.');
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  const statusText = result === null ? null
    : result.status === 'found' ? `${result.nodes.length - 1} ${result.nodes.length === 2 ? 'link' : 'links'}`
      : result.status === 'same-node' ? 'The source and destination are the same note.'
        : result.status === 'missing' ? 'One or both notes are no longer available.'
          : result.status === 'disconnected' ? 'No path exists with the current traversal mode.'
            : 'The search reached its traversal bound before a path was found.';

  return (
    <section className="flex flex-col gap-2 border-t pt-3" aria-label="Shortest path">
      <h3 className="flex items-center gap-1.5 text-xs font-medium"><Route className="size-3.5 text-muted-foreground" aria-hidden="true" />Shortest path</h3>
      <div className="grid gap-1.5">
        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="w-full justify-between font-normal" aria-label="Choose path destination">
              <span className="min-w-0 truncate">{target?.title ?? 'Choose destination'}</span>
              <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-[min(22rem,calc(100vw-2rem))] p-0">
            <Command>
              <CommandInput placeholder="Search notes…" />
              <CommandList>
                <CommandEmpty>No matching notes.</CommandEmpty>
                {candidates.map((node) => (
                  <CommandItem key={node.id} value={`${node.title} ${node.path}`} onSelect={() => { setTargetId(node.id); setPickerOpen(false); setResult(null); }}>
                    <span className="min-w-0 flex-1 truncate">{node.title}</span>
                    <span className="max-w-[45%] truncate font-mono text-[10px] text-muted-foreground">{node.path}</span>
                  </CommandItem>
                ))}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
        <div className="flex gap-1.5">
          <Select value={mode} onValueChange={(value) => { onModeChange(value as GraphTraversalMode); setResult(null); }}>
            <SelectTrigger className="flex-1" aria-label="Path traversal mode">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="directed">Follow link direction</SelectItem>
              <SelectItem value="undirected">Ignore direction</SelectItem>
            </SelectContent>
          </Select>
          <Button size="sm" disabled={targetId === null || loading} onClick={() => void findPath()}>
            {loading ? <LoaderCircle className="animate-spin" /> : <Route />}Find
          </Button>
        </div>
      </div>
      {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
      {result ? (
        <div className="flex flex-col gap-1.5" aria-live="polite">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Badge variant="secondary">{statusText}</Badge>
            <span>{result.mode === 'directed' ? 'Directed' : 'Undirected'}</span>
          </div>
          {result.nodes.length > 0 ? <ol className="flex flex-wrap items-center gap-1 text-xs" aria-label="Path notes">
            {result.nodes.map((node, index) => <li key={node.id} className="flex items-center gap-1">
              <Button variant={index === 0 ? 'secondary' : 'ghost'} size="sm" className="h-auto max-w-[9rem] truncate px-1.5 py-0.5" onClick={() => onSelectNode(node.id)}>{node.title}</Button>
              {index < result.nodes.length - 1 ? <ArrowRight className="size-3 text-muted-foreground" aria-hidden="true" /> : null}
            </li>)}
          </ol> : null}
        </div>
      ) : null}
    </section>
  );
}
