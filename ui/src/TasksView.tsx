import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CheckCircle2, Circle, FolderInput, ListFilter, ListTodo, RefreshCw, X } from 'lucide-react';
import type { UiTask, UiTasksResponse } from '../../src/ui-server/dto';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from './api';
import {
  dueBucket,
  filterTasks,
  folderOf,
  groupTasks,
  localToday,
  sortTasks,
  VAULT_ROOT_FILTER,
  type TaskGroupBy,
  type TaskSort,
  type TaskStatusFilter,
} from './task-view';

interface Props {
  vaultIdentity: string;
  revision: number;
  onOpenTask: (noteId: string, line: number) => void;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
}

export function TasksView({ vaultIdentity, revision, onOpenTask, sidebarCollapsed, onToggleSidebar }: Props) {
  const [data, setData] = useState<UiTasksResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [status, setStatus] = useState<TaskStatusFilter>('all');
  const [query, setQuery] = useState('');
  const [folder, setFolder] = useState('');
  const [sort, setSort] = useState<TaskSort>('document');
  const [group, setGroup] = useState<TaskGroupBy>('note');
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [visibleCount, setVisibleCount] = useState(200);
  const request = useRef(0);
  const mounted = useRef(true);

  async function load(refresh = false) {
    const current = ++request.current;
    setLoading(true);
    setError(null);
    try {
      const result = await api.tasks(refresh);
      if (mounted.current && current === request.current) setData(result);
    } catch (reason) {
      if (mounted.current && current === request.current) setError(messageOf(reason));
    } finally {
      if (mounted.current && current === request.current) setLoading(false);
    }
  }

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => { mounted.current = false; request.current++; };
  }, [vaultIdentity, revision]);

  useEffect(() => { setVisibleCount(200); }, [status, query, folder, sort, group]);

  const folders = useMemo(() => [...new Set((data?.tasks ?? []).map((task) => folderOf(task.notePath)).filter(Boolean))].sort(), [data]);
  const filtered = useMemo(() => sortTasks(filterTasks(data?.tasks ?? [], { status, query, folder }), sort), [data, status, query, folder, sort]);
  const visible = useMemo(() => filtered.slice(0, visibleCount), [filtered, visibleCount]);
  const today = localToday();
  const groups = useMemo(() => groupTasks(visible, group, today), [visible, group, today]);

  async function toggle(task: UiTask) {
    if (busyId !== null) return;
    setBusyId(task.id);
    setActionError(null);
    try {
      await api.toggleTask(task.noteId, { taskId: task.id, checked: !task.checked, baseHash: task.noteContentHash });
      await load(true);
    } catch (reason) {
      setActionError(`${messageOf(reason)} The task list was refreshed; try again if the task still exists.`);
      await load(true);
    } finally {
      if (mounted.current) setBusyId(null);
    }
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label="Tasks">
      <header className="flex min-h-12 flex-wrap items-center gap-2 border-b px-4 py-2">
        {sidebarCollapsed ? <Button variant="ghost" size="icon-sm" aria-label="Expand sidebar" onClick={onToggleSidebar}><FolderInput /></Button> : null}
        <ListTodo className="size-4 text-muted-foreground" aria-hidden="true" />
        <h1 className="flex-1 text-sm font-medium">Tasks</h1>
        {data ? <span className="text-xs text-muted-foreground">{data.counts.open} open · {data.counts.completed} completed</span> : null}
        <Button variant="ghost" size="sm" disabled={loading} onClick={() => void load(true)}><RefreshCw data-icon="inline-start" />Refresh</Button>
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-4 md:p-8" aria-busy={loading}>
        <div className="mx-auto flex max-w-4xl flex-col gap-5">
          <p className="max-w-[74ch] text-sm leading-6 text-muted-foreground">Tasks come directly from Markdown checkboxes. Completing a task changes only its checkbox marker; every surrounding note and the underlying syntax stay editable.</p>

          {error ? <div role="alert" className="flex flex-wrap items-center gap-3 border border-destructive/25 bg-destructive/5 px-3 py-2 text-sm text-destructive"><span className="min-w-0 flex-1">{error}</span><Button variant="outline" size="sm" onClick={() => void load(true)}>Retry</Button></div> : null}
          {actionError ? <div role="alert" className="flex flex-wrap items-center gap-3 border border-destructive/25 bg-destructive/5 px-3 py-2 text-sm text-destructive"><span className="min-w-0 flex-1">{actionError}</span><Button variant="ghost" size="icon-sm" aria-label="Dismiss task error" onClick={() => setActionError(null)}><X /></Button></div> : null}
          {loading && data === null ? <div className="flex flex-col gap-3" aria-label="Loading tasks"><Skeleton className="h-10 w-full" /><Skeleton className="h-40 w-full" /><Skeleton className="h-40 w-full" /></div> : null}

          {data ? <>
            {data.truncated ? <p role="status" className="text-xs text-muted-foreground">Showing the first {data.tasks.length.toLocaleString()} tasks. Refine the vault before relying on the complete list.</p> : null}
            <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter tasks by status">
              <StatusButton label="All" count={data.counts.total} active={status === 'all'} onClick={() => setStatus('all')} />
              <StatusButton label="Open" count={data.counts.open} active={status === 'open'} onClick={() => setStatus('open')} icon={<Circle />} />
              <StatusButton label="Completed" count={data.counts.completed} active={status === 'completed'} onClick={() => setStatus('completed')} icon={<CheckCircle2 />} />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Input aria-label="Filter tasks" placeholder="Filter tasks…" value={query} onChange={(event) => setQuery(event.target.value)} className="min-w-48 flex-1" />
              <Popover open={optionsOpen} onOpenChange={setOptionsOpen}>
                <PopoverTrigger asChild><Button variant="outline" size="sm"><ListFilter data-icon="inline-start" />View options</Button></PopoverTrigger>
                <PopoverContent align="end" className="w-72">
                  <div className="flex flex-col gap-3">
                    <label className="flex flex-col gap-1.5 text-xs font-medium">Folder
                      <Select value={folder === '' ? 'all' : folder} onValueChange={(value) => setFolder(value === 'all' ? '' : value)}>
                        <SelectTrigger aria-label="Filter by folder"><SelectValue /></SelectTrigger>
                        <SelectContent><SelectItem value="all">All folders</SelectItem>{folders.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}{data.tasks.some((task) => folderOf(task.notePath) === '') ? <SelectItem value={VAULT_ROOT_FILTER}>Vault root</SelectItem> : null}</SelectContent>
                      </Select>
                    </label>
                    <label className="flex flex-col gap-1.5 text-xs font-medium">Sort by
                      <Select value={sort} onValueChange={(value) => setSort(value as TaskSort)}>
                        <SelectTrigger aria-label="Sort tasks"><SelectValue /></SelectTrigger>
                        <SelectContent><SelectItem value="document">Document order</SelectItem><SelectItem value="note">Note title</SelectItem><SelectItem value="status">Status</SelectItem><SelectItem value="due">Due date</SelectItem></SelectContent>
                      </Select>
                    </label>
                    <label className="flex flex-col gap-1.5 text-xs font-medium">Group by
                      <Select value={group} onValueChange={(value) => setGroup(value as TaskGroupBy)}>
                        <SelectTrigger aria-label="Group tasks"><SelectValue /></SelectTrigger>
                        <SelectContent><SelectItem value="none">None</SelectItem><SelectItem value="note">Note</SelectItem><SelectItem value="folder">Folder</SelectItem><SelectItem value="status">Status</SelectItem><SelectItem value="due">Due date</SelectItem></SelectContent>
                      </Select>
                    </label>
                  </div>
                </PopoverContent>
              </Popover>
            </div>

            {filtered.length > visible.length ? <p className="text-xs text-muted-foreground" role="status">Showing {visible.length.toLocaleString()} of {filtered.length.toLocaleString()} matching tasks.</p> : null}
            {data.tasks.length === 0 ? <div className="border border-dashed px-5 py-12 text-center"><h2 className="text-sm font-semibold">No tasks yet</h2><p className="mt-2 text-sm text-muted-foreground">Add a Markdown checkbox to any note, for example <code className="font-mono text-xs">- [ ] Review the draft</code>.</p></div> : null}
            {data.tasks.length > 0 && filtered.length === 0 ? <div className="border border-dashed px-5 py-10 text-center"><h2 className="text-sm font-semibold">No matching tasks</h2><p className="mt-2 text-sm text-muted-foreground">Clear the filter or choose a different status.</p><Button variant="link" size="sm" onClick={() => { setQuery(''); setFolder(''); setStatus('all'); }}>Clear filters</Button></div> : null}
            {groups.map((section) => section.tasks.length ? <section key={section.key} aria-label={section.label} className="flex flex-col gap-2">
              <div className="flex items-baseline gap-2"><h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{section.label}</h2><span className="text-xs tabular-nums text-muted-foreground">{section.tasks.length}</span></div>
              <ul className="flex flex-col divide-y border">{section.tasks.map((task) => <TaskRow key={task.id} task={task} today={today} busy={busyId !== null} onToggle={() => void toggle(task)} onOpen={() => onOpenTask(task.noteId, task.line)} />)}</ul>
            </section> : null)}
            {filtered.length > visible.length ? <Button variant="outline" size="sm" className="self-center" onClick={() => setVisibleCount((count) => count + 200)}>Show more tasks</Button> : null}
          </> : null}
        </div>
      </div>
    </section>
  );
}

function StatusButton({ label, count, active, onClick, icon }: { label: string; count: number; active: boolean; onClick: () => void; icon?: ReactNode }) {
  return <Button size="sm" variant={active ? 'secondary' : 'outline'} aria-pressed={active} onClick={onClick}>{icon ? <span data-icon="inline-start">{icon}</span> : null}{label} <span className="tabular-nums text-muted-foreground">{count}</span></Button>;
}

function TaskRow({ task, today, busy, onToggle, onOpen }: { task: UiTask; today: string; busy: boolean; onToggle: () => void; onOpen: () => void }) {
  const due = dueBucket(task, today);
  return <li className="flex items-start gap-3 bg-background p-3 sm:px-4">
    <Checkbox className="mt-0.5" checked={task.checked} disabled={busy} aria-label={task.checked ? `Mark “${task.text || 'Untitled task'}” incomplete` : `Mark “${task.text || 'Untitled task'}” complete`} onCheckedChange={onToggle} />
    <div className="min-w-0 flex-1">
      <Button variant="ghost" className="h-auto min-h-0 w-full justify-start whitespace-normal break-words p-0 text-left text-sm font-normal" onClick={onOpen}>{task.text || <span className="italic text-muted-foreground">Untitled task</span>}</Button>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
        <span>{task.heading ? `${task.heading} · ` : ''}line {task.line}</span>
        <Button variant="link" size="sm" className="h-auto p-0 text-[11px]" onClick={onOpen}>{task.noteTitle}</Button>
        {task.dueDate ? <Badge variant={due === 'overdue' ? 'destructive' : 'outline'}>Due {task.dueDate}</Badge> : null}
        {task.priority ? <Badge variant="secondary">{task.priority} priority</Badge> : null}
      </div>
    </div>
  </li>;
}

function messageOf(error: unknown): string { return error instanceof Error ? error.message : 'Could not load tasks.'; }
