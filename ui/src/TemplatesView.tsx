import { useEffect, useRef, useState } from 'react';
import { CopyPlus, FilePlus2, LoaderCircle, Save, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { projectManagementTemplates } from '../../src/database/project-templates';
import { api } from './api';
import { SidebarToggle } from './SidebarToggle';
import type { UiDatabase } from '../../src/ui-server/dto';
import type { DatabaseTemplate, NodusTemplate, NoteTemplate } from '../../src/database/templates';

function message(error: unknown) { return error instanceof Error ? error.message : 'The template request failed.'; }
function uid() { return globalThis.crypto?.randomUUID?.() ?? `template-${Date.now()}`; }

export function TemplatesView({ vaultPath, databases, onApplied, sidebarCollapsed, onToggleSidebar }: { vaultPath: string; databases: UiDatabase[]; onApplied: () => void; sidebarCollapsed: boolean; onToggleSidebar: () => void }) {
  const [templates, setTemplates] = useState<NodusTemplate[]>([]);
  const draft = useRef<NodusTemplate[]>([]);
  const replaceDraft = (next: NodusTemplate[]) => {
    draft.current = next;
    setTemplates(next);
  };
  const [hash, setHash] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [catalogReady, setCatalogReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const lifetime = useRef<AbortController | null>(null);
  const catalogOperation = useRef<'capture' | 'save' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [variableText, setVariableText] = useState('{}');
  const [variableDefinitions, setVariableDefinitions] = useState('[]');
  const [frontmatterText, setFrontmatterText] = useState('{}');
  const [tagsText, setTagsText] = useState('');
  const [aliasesText, setAliasesText] = useState('');
  const [iconText, setIconText] = useState('');
  const [preview, setPreview] = useState<{ templateId: string; request: number; data: unknown } | null>(null);
  const previewRequest = useRef(0);
  const invalidatePreview = () => {
    previewRequest.current += 1;
    setPreview(null);
  };
  const selectTemplate = (id: string | null) => {
    invalidatePreview();
    setSelected(id);
  };
  const [includeStarterRows, setIncludeStarterRows] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    const { signal } = controller;
    void api.templates(vaultPath, signal).then((result) => {
      if (signal.aborted) return;
      replaceDraft(result.templates);
      setHash(result.hash);
      setCatalogReady(true);
    }).catch((failure: unknown) => {
      if (!signal.aborted) setError(message(failure));
    }).finally(() => {
      if (!signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [vaultPath]);
  const active = templates.find((template) => template.id === selected) ?? null;
  useEffect(() => {
    if (active?.type !== 'note') return;
    setVariableDefinitions(JSON.stringify(active.variables, null, 2));
    setFrontmatterText(JSON.stringify(active.frontmatter, null, 2));
    setTagsText(active.tags.join(', ')); setAliasesText(active.aliases.join(', ')); setIconText(active.icon ?? '');
  }, [selected]);
  const save = async (next: NodusTemplate[], includeNoteDraft = true, signal = lifetime.current?.signal) => {
    if (!signal || signal.aborted || loading || catalogOperation.current !== null) return;
    catalogOperation.current = 'save';
    invalidatePreview();
    setSaving(true); setError(null); setNotice(null);
    try {
      let submitted = next;
      const candidate = next.find((item) => item.id === selected);
      if (includeNoteDraft && candidate?.type === 'note') {
        submitted = next.map((item) => item.id === candidate.id ? { ...candidate,
          tags: tagsText.split(',').map((tag) => tag.trim()).filter(Boolean), aliases: aliasesText.split(',').map((alias) => alias.trim()).filter(Boolean),
          icon: iconText.trim() || undefined, frontmatter: JSON.parse(frontmatterText), variables: JSON.parse(variableDefinitions),
        } : item);
      }
      const result = await api.saveTemplates(submitted, hash, vaultPath, signal);
      if (signal.aborted) return;
      replaceDraft(result.templates); setHash(result.hash); setNotice('Template library saved.');
    }
    catch (failure) { if (!signal.aborted) setError(message(failure)); }
    finally { if (!signal.aborted) { catalogOperation.current = null; setSaving(false); } }
  };
  const projectTemplates = projectManagementTemplates(new Date().toISOString())
    .filter((preset) => !templates.some((template) => template.id === preset.id));
  const addProjectTemplates = () => {
    const first = projectTemplates[0];
    if (!first || catalogOperation.current === 'save') return;
    const current = draft.current;
    selectTemplate(first.id);
    replaceDraft([...current, ...projectTemplates.filter((preset) => !current.some((template) => template.id === preset.id))]);
    setNotice('Project templates added. Save the template library before applying them.');
  };
  const addNote = () => {
    if (catalogOperation.current === 'save') return;
    const now = new Date().toISOString();
    const item: NoteTemplate = { id: uid(), type: 'note', name: 'New note template', title: 'Untitled note', body: '', tags: [], aliases: [], frontmatter: {}, variables: [], createdAt: now, updatedAt: now };
    replaceDraft([...draft.current, item]); selectTemplate(item.id); setNotice('Edit the template, then save it.');
  };
  const addDatabase = async (databaseId: string) => {
    const source = databases.find((item) => item.id === databaseId);
    const signal = lifetime.current?.signal;
    if (!signal || signal.aborted || !source || !catalogReady || catalogOperation.current !== null) return;
    const startingSelection = previewRequest.current;
    catalogOperation.current = 'capture';
    setCapturing(true);
    setError(null);
    try {
      const [savedViews, rows] = await Promise.all([
        api.databaseViews(source.id, vaultPath, signal),
        includeStarterRows ? api.databaseRows(source.id, source.contentHash, vaultPath, signal) : Promise.resolve({ rows: [] }),
      ]);
      if (signal.aborted) return;
      const now = new Date().toISOString();
      const template: DatabaseTemplate = {
        id: uid(), type: 'database', name: `${source.name} template`, database: { id: source.id, name: source.name, properties: source.properties },
        views: savedViews.views.map((item) => item.view), starterRows: rows.rows.map((row) => ({ title: row.title, values: row.values })), createdAt: now, updatedAt: now,
      };
      // Capture can overlap local draft edits. Read the draft only once the
      // capture data arrives, then hold the write lock through persistence.
      const next = [...draft.current, template];
      replaceDraft(next);
      const selectionUnchanged = previewRequest.current === startingSelection;
      if (selectionUnchanged) selectTemplate(template.id);
      catalogOperation.current = null;
      await save(next, selectionUnchanged, signal);
    } catch (failure) { if (!signal.aborted) setError(message(failure)); }
    finally {
      if (!signal.aborted) {
        catalogOperation.current = null;
        setCapturing(false);
      }
    }
  };
  const update = (changes: Partial<NoteTemplate>) => {
    if (!active || active.type !== 'note' || catalogOperation.current === 'save') return;
    invalidatePreview();
    replaceDraft(draft.current.map((item) => item.id === active.id ? { ...active, ...changes, updatedAt: new Date().toISOString() } : item));
  };
  const rename = (name: string) => {
    if (catalogOperation.current === 'save') return;
    invalidatePreview();
    replaceDraft(draft.current.map((item) => item.id === active?.id ? { ...item, name, updatedAt: new Date().toISOString() } : item));
  };
  const previewAction = async () => {
    if (!active || catalogOperation.current === 'save') return;
    invalidatePreview();
    const request = previewRequest.current;
    try {
      const variables = JSON.parse(variableText) as Record<string, unknown>;
      const data = await api.templateAction(active.id, 'preview', variables);
      if (request !== previewRequest.current) return;
      setPreview({ templateId: active.id, request, data });
      setError(null);
    } catch (failure) {
      if (request === previewRequest.current) setError(message(failure));
    }
  };
  const currentPreview = preview?.templateId === selected ? preview : null;
  const apply = async () => {
    if (!active || active.id !== selected || currentPreview?.templateId !== active.id ||
        currentPreview.request !== previewRequest.current || catalogOperation.current === 'save') return;
    try {
      const variables = JSON.parse(variableText) as Record<string, unknown>;
      const result = await api.templateAction(active.id, 'apply', variables) as { report?: { transactionCleanupPending?: boolean } };
      setNotice(active.type === 'note'
        ? 'Note created from template.'
        : result.report?.transactionCleanupPending
          ? 'Database created. Transaction cleanup is pending; check Storage health before another apply.'
          : 'Database created from template.');
      setError(null); onApplied();
    } catch (failure) { setError(message(failure)); }
  };
  const remove = async () => {
    if (!active || catalogOperation.current !== null) return;
    selectTemplate(null);
    await save(draft.current.filter((item) => item.id !== active.id));
  };

  return <main className="mx-auto flex h-full w-full max-w-6xl flex-col gap-5 overflow-auto px-6 py-7">
    <header className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-5">
      <div><p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">Reusable structures</p><h1 className="mt-1 text-2xl font-semibold tracking-tight">Templates</h1><p className="mt-1 max-w-xl text-sm text-muted-foreground">Create notes and databases from saved structures. Every apply action creates a new item after preview.</p></div>
      <div className="flex flex-wrap items-center gap-3"><SidebarToggle collapsed={sidebarCollapsed} onToggle={onToggleSidebar} /><Button variant="outline" disabled={loading || saving} onClick={addNote}><FilePlus2 />Note template</Button><label className="flex items-center gap-2 text-xs text-muted-foreground"><Checkbox checked={includeStarterRows} onCheckedChange={(checked) => setIncludeStarterRows(checked === true)} />Include current rows</label><select aria-label="Create database template" disabled={!catalogReady || loading || saving || capturing} className="h-9 max-w-56 rounded-md border border-input bg-background px-3 text-sm disabled:opacity-50" value="" onChange={(event) => { if (event.target.value) void addDatabase(event.target.value); }}><option value="">From database…</option>{databases.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
    </header>
    <section aria-labelledby="project-template-heading" className="rounded-md border p-4 text-sm">
      <h2 id="project-template-heading" className="font-semibold">Project management</h2>
      <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted-foreground">
        <li>Add the starter templates and select Save. Select Projects, then use Preview and Create from template. Give each copy a distinct database name if you set up more than one pair.</li>
        <li>Repeat for Work Items. In Databases, open Work Items and choose Edit schema. Add a Relation named Project, select your Projects database, choose One record, then save the schema.</li>
        <li>Use Columns → Project → Save view to show the relation in each saved view. Create notes first, then use Add note to add them to each database. Set Type to Task or Bug, and put project briefs or bug reproduction steps in the note body.</li>
      </ol>
      <Button className="mt-3" variant="outline" disabled={!catalogReady || loading || saving || projectTemplates.length === 0} onClick={addProjectTemplates}>
        Add project templates
      </Button>
    </section>
    {error ? <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error}</div> : null}
    {notice ? <div role="status" className="rounded-md border border-border bg-muted/40 p-3 text-sm">{notice}</div> : null}
    {loading ? <div className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />Loading templates…</div> : templates.length === 0 ? <section className="rounded-lg border border-dashed p-8 text-center"><h2 className="font-medium">No templates yet</h2><p className="mt-1 text-sm text-muted-foreground">Start with a note template or capture a database with its saved views and rows.</p><Button className="mt-4" onClick={addNote}><FilePlus2 />Create note template</Button></section> : <div className="grid min-h-0 flex-1 gap-5 md:grid-cols-[260px_minmax(0,1fr)]">
      <nav aria-label="Template list" className="flex flex-col gap-1 border-r border-border pr-3">{templates.map((item) => <button key={item.id} onClick={() => selectTemplate(item.id)} className={`rounded-md px-3 py-2 text-left ${selected === item.id ? 'bg-accent text-accent-foreground' : 'hover:bg-muted'}`}><span className="block truncate text-sm font-medium">{item.name}</span><Badge variant="secondary" className="mt-1">{item.type === 'note' ? 'Note' : 'Database'}</Badge></button>)}</nav>
      <section className="min-w-0 rounded-lg border border-border bg-card p-5">
        {!active ? <p className="text-sm text-muted-foreground">Choose a template to edit, preview, or apply.</p> : <>
          <div className="flex flex-wrap items-center justify-between gap-3"><div><Badge variant="outline">{active.type === 'note' ? 'Note template' : 'Database template'}</Badge><p className="mt-2 text-sm text-muted-foreground">{active.type === 'note' ? 'Markdown body, title, tags, aliases, and frontmatter.' : `${active.database.properties.length} properties · ${active.views.length} views · ${active.starterRows.length} starter rows`}</p></div><div className="flex gap-2"><Button variant="outline" aria-label="Save template library" disabled={saving || capturing} onClick={() => void save(draft.current)}><Save />Save</Button><Button variant="ghost" aria-label="Delete template" disabled={saving || capturing} onClick={() => void remove()}><Trash2 /></Button></div></div>
          <fieldset disabled={saving}>
          <label className="mt-4 grid max-w-lg gap-1 text-sm">Template name<Input value={active.name} onChange={(event) => rename(event.target.value)} /></label>
          {active.type === 'note' ? <div className="mt-5 grid gap-3"><label className="grid gap-1 text-sm">New note title<Input value={active.title} onChange={(event) => update({ title: event.target.value })} /></label><label className="grid gap-1 text-sm">Markdown body<Textarea className="min-h-48 font-mono text-sm" value={active.body} onChange={(event) => update({ body: event.target.value })} /></label><label className="grid gap-1 text-sm">Tags<Input value={tagsText} onChange={(event) => { setTagsText(event.target.value); invalidatePreview(); }} placeholder="Comma-separated" /></label><label className="grid gap-1 text-sm">Aliases<Input value={aliasesText} onChange={(event) => { setAliasesText(event.target.value); invalidatePreview(); }} placeholder="Comma-separated" /></label><label className="grid gap-1 text-sm">Icon<Input value={iconText} maxLength={8} onChange={(event) => { setIconText(event.target.value); invalidatePreview(); }} placeholder="Optional emoji" /></label><label className="grid gap-1 text-sm">Custom frontmatter (JSON)<Textarea className="min-h-20 font-mono text-xs" value={frontmatterText} onChange={(event) => { setFrontmatterText(event.target.value); invalidatePreview(); }} /></label><label className="grid gap-1 text-sm">Variable definitions (JSON)<Textarea className="min-h-20 font-mono text-xs" value={variableDefinitions} onChange={(event) => { setVariableDefinitions(event.target.value); invalidatePreview(); }} /></label><p className="text-xs text-muted-foreground">Variables use <code>{'{{name}}'}</code> syntax. Define text, date, or number variables above.</p><label className="grid gap-1 text-sm">Variable values (JSON)<Textarea className="min-h-16 font-mono text-xs" value={variableText} onChange={(event) => { setVariableText(event.target.value); invalidatePreview(); }} /></label></div> : <div className="mt-5 rounded-md bg-muted/40 p-4 text-sm"><p className="font-medium">{active.database.name}</p><p className="mt-1 text-muted-foreground">Schema, saved views, and starter rows are captured from the source database.</p></div>}
          </fieldset>
          {currentPreview !== null ? <pre className="mt-4 max-h-56 overflow-auto rounded-md border bg-muted/30 p-3 text-xs">{JSON.stringify(currentPreview.data, null, 2)}</pre> : null}
          <div className="mt-5 flex flex-wrap gap-2"><Button variant="outline" disabled={saving} onClick={() => void previewAction()}><CopyPlus />Preview</Button><Button disabled={currentPreview === null || saving} onClick={() => void apply()}>Create from template</Button></div>
        </>}
      </section>
    </div>}
  </main>;
}
