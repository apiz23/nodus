import { useEffect, useState } from 'react';
import { CopyPlus, FilePlus2, LoaderCircle, Save, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { api } from './api';
import type { UiDatabase } from '../../src/ui-server/dto';
import type { DatabaseTemplate, NodusTemplate, NoteTemplate } from '../../src/database/templates';

function message(error: unknown) { return error instanceof Error ? error.message : 'The template request failed.'; }
function uid() { return globalThis.crypto?.randomUUID?.() ?? `template-${Date.now()}`; }

export function TemplatesView({ databases, onApplied }: { databases: UiDatabase[]; onApplied: () => void }) {
  const [templates, setTemplates] = useState<NodusTemplate[]>([]);
  const [hash, setHash] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [variableText, setVariableText] = useState('{}');
  const [variableDefinitions, setVariableDefinitions] = useState('[]');
  const [frontmatterText, setFrontmatterText] = useState('{}');
  const [tagsText, setTagsText] = useState('');
  const [aliasesText, setAliasesText] = useState('');
  const [iconText, setIconText] = useState('');
  const [preview, setPreview] = useState<unknown>(null);
  const [includeStarterRows, setIncludeStarterRows] = useState(false);

  const refresh = async () => {
    setLoading(true); setError(null);
    try { const result = await api.templates(); setTemplates(result.templates); setHash(result.hash); }
    catch (failure) { setError(message(failure)); }
    finally { setLoading(false); }
  };
  useEffect(() => { void refresh(); }, []);
  const active = templates.find((template) => template.id === selected) ?? null;
  useEffect(() => {
    if (active?.type !== 'note') return;
    setVariableDefinitions(JSON.stringify(active.variables, null, 2));
    setFrontmatterText(JSON.stringify(active.frontmatter, null, 2));
    setTagsText(active.tags.join(', ')); setAliasesText(active.aliases.join(', ')); setIconText(active.icon ?? '');
  }, [selected]);
  const save = async (next: NodusTemplate[]) => {
    setSaving(true); setError(null); setNotice(null);
    try {
      let submitted = next;
      const candidate = next.find((item) => item.id === selected);
      if (candidate?.type === 'note') {
        submitted = next.map((item) => item.id === candidate.id ? { ...candidate,
          tags: tagsText.split(',').map((tag) => tag.trim()).filter(Boolean), aliases: aliasesText.split(',').map((alias) => alias.trim()).filter(Boolean),
          icon: iconText.trim() || undefined, frontmatter: JSON.parse(frontmatterText), variables: JSON.parse(variableDefinitions),
        } : item);
      }
      const result = await api.saveTemplates(submitted, hash); setTemplates(result.templates); setHash(result.hash); setNotice('Template library saved.');
    }
    catch (failure) { setError(message(failure)); }
    finally { setSaving(false); }
  };
  const addNote = () => {
    const now = new Date().toISOString();
    const item: NoteTemplate = { id: uid(), type: 'note', name: 'New note template', title: 'Untitled note', body: '', tags: [], aliases: [], frontmatter: {}, variables: [], createdAt: now, updatedAt: now };
    setTemplates((current) => [...current, item]); setSelected(item.id); setNotice('Edit the template, then save it.');
  };
  const addDatabase = async (databaseId: string) => {
    const source = databases.find((item) => item.id === databaseId);
    if (!source) return;
    setError(null);
    try {
      const [savedViews, rows] = await Promise.all([api.databaseViews(source.id), includeStarterRows ? api.databaseRows(source.id) : Promise.resolve({ rows: [] })]);
      const now = new Date().toISOString();
      const template: DatabaseTemplate = {
        id: uid(), type: 'database', name: `${source.name} template`, database: { id: source.id, name: source.name, properties: source.properties },
        views: savedViews.views.map((item) => item.view), starterRows: rows.rows.map((row) => ({ title: row.title, values: row.values })), createdAt: now, updatedAt: now,
      };
      const next = [...templates, template]; setTemplates(next); setSelected(template.id); await save(next);
    } catch (failure) { setError(message(failure)); }
  };
  const update = (changes: Partial<NoteTemplate>) => {
    if (!active || active.type !== 'note') return;
    setPreview(null);
    setTemplates((current) => current.map((item) => item.id === active.id ? { ...active, ...changes, updatedAt: new Date().toISOString() } : item));
  };
  const rename = (name: string) => { setPreview(null); setTemplates((current) => current.map((item) => item.id === active?.id ? { ...item, name, updatedAt: new Date().toISOString() } : item)); };
  const previewAction = async () => {
    if (!active) return;
    try {
      const variables = JSON.parse(variableText) as Record<string, unknown>;
      setPreview(await api.templateAction(active.id, 'preview', variables)); setError(null);
    } catch (failure) { setError(message(failure)); }
  };
  const apply = async () => {
    if (!active || preview === null) return;
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
  const remove = async () => { if (!active) return; const next = templates.filter((item) => item.id !== active.id); setSelected(null); await save(next); };

  return <main className="mx-auto flex h-full w-full max-w-6xl flex-col gap-5 overflow-auto px-6 py-7">
    <header className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-5">
      <div><p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">Reusable structures</p><h1 className="mt-1 text-2xl font-semibold tracking-tight">Templates</h1><p className="mt-1 max-w-xl text-sm text-muted-foreground">Create notes and databases from saved structures. Every apply action creates a new item after preview.</p></div>
      <div className="flex flex-wrap items-center gap-3"><Button variant="outline" disabled={loading} onClick={addNote}><FilePlus2 />Note template</Button><label className="flex items-center gap-2 text-xs text-muted-foreground"><Checkbox checked={includeStarterRows} onCheckedChange={(checked) => setIncludeStarterRows(checked === true)} />Include current rows</label><select aria-label="Create database template" disabled={loading} className="h-9 max-w-56 rounded-md border border-input bg-background px-3 text-sm disabled:opacity-50" value="" onChange={(event) => { if (event.target.value) void addDatabase(event.target.value); }}><option value="">From database…</option>{databases.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
    </header>
    {error ? <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error}</div> : null}
    {notice ? <div role="status" className="rounded-md border border-border bg-muted/40 p-3 text-sm">{notice}</div> : null}
    {loading ? <div className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />Loading templates…</div> : templates.length === 0 ? <section className="rounded-lg border border-dashed p-8 text-center"><h2 className="font-medium">No templates yet</h2><p className="mt-1 text-sm text-muted-foreground">Start with a note template or capture a database with its saved views and rows.</p><Button className="mt-4" onClick={addNote}><FilePlus2 />Create note template</Button></section> : <div className="grid min-h-0 flex-1 gap-5 md:grid-cols-[260px_minmax(0,1fr)]">
      <nav aria-label="Template list" className="flex flex-col gap-1 border-r border-border pr-3">{templates.map((item) => <button key={item.id} onClick={() => { setSelected(item.id); setPreview(null); }} className={`rounded-md px-3 py-2 text-left ${selected === item.id ? 'bg-accent text-accent-foreground' : 'hover:bg-muted'}`}><span className="block truncate text-sm font-medium">{item.name}</span><Badge variant="secondary" className="mt-1">{item.type === 'note' ? 'Note' : 'Database'}</Badge></button>)}</nav>
      <section className="min-w-0 rounded-lg border border-border bg-card p-5">
        {!active ? <p className="text-sm text-muted-foreground">Choose a template to edit, preview, or apply.</p> : <>
          <div className="flex flex-wrap items-center justify-between gap-3"><div><Badge variant="outline">{active.type === 'note' ? 'Note template' : 'Database template'}</Badge><p className="mt-2 text-sm text-muted-foreground">{active.type === 'note' ? 'Markdown body, title, tags, aliases, and frontmatter.' : `${active.database.properties.length} properties · ${active.views.length} views · ${active.starterRows.length} starter rows`}</p></div><div className="flex gap-2"><Button variant="outline" disabled={saving} onClick={() => void save(templates)}><Save />Save</Button><Button variant="ghost" aria-label="Delete template" onClick={() => void remove()}><Trash2 /></Button></div></div>
          <label className="mt-4 grid max-w-lg gap-1 text-sm">Template name<Input value={active.name} onChange={(event) => rename(event.target.value)} /></label>
          {active.type === 'note' ? <div className="mt-5 grid gap-3"><label className="grid gap-1 text-sm">New note title<Input value={active.title} onChange={(event) => update({ title: event.target.value })} /></label><label className="grid gap-1 text-sm">Markdown body<Textarea className="min-h-48 font-mono text-sm" value={active.body} onChange={(event) => update({ body: event.target.value })} /></label><label className="grid gap-1 text-sm">Tags<Input value={tagsText} onChange={(event) => { setTagsText(event.target.value); setPreview(null); }} placeholder="Comma-separated" /></label><label className="grid gap-1 text-sm">Aliases<Input value={aliasesText} onChange={(event) => { setAliasesText(event.target.value); setPreview(null); }} placeholder="Comma-separated" /></label><label className="grid gap-1 text-sm">Icon<Input value={iconText} maxLength={8} onChange={(event) => { setIconText(event.target.value); setPreview(null); }} placeholder="Optional emoji" /></label><label className="grid gap-1 text-sm">Custom frontmatter (JSON)<Textarea className="min-h-20 font-mono text-xs" value={frontmatterText} onChange={(event) => { setFrontmatterText(event.target.value); setPreview(null); }} /></label><label className="grid gap-1 text-sm">Variable definitions (JSON)<Textarea className="min-h-20 font-mono text-xs" value={variableDefinitions} onChange={(event) => { setVariableDefinitions(event.target.value); setPreview(null); }} /></label><p className="text-xs text-muted-foreground">Variables use <code>{'{{name}}'}</code> syntax. Define text, date, or number variables above.</p><label className="grid gap-1 text-sm">Variable values (JSON)<Textarea className="min-h-16 font-mono text-xs" value={variableText} onChange={(event) => setVariableText(event.target.value)} /></label></div> : <div className="mt-5 rounded-md bg-muted/40 p-4 text-sm"><p className="font-medium">{active.database.name}</p><p className="mt-1 text-muted-foreground">Schema, saved views, and starter rows are captured from the source database.</p></div>}
          {preview !== null ? <pre className="mt-4 max-h-56 overflow-auto rounded-md border bg-muted/30 p-3 text-xs">{JSON.stringify(preview, null, 2)}</pre> : null}
          <div className="mt-5 flex flex-wrap gap-2"><Button variant="outline" onClick={() => void previewAction()}><CopyPlus />Preview</Button><Button disabled={preview === null} onClick={() => void apply()}>Create from template</Button></div>
        </>}
      </section>
    </div>}
  </main>;
}
