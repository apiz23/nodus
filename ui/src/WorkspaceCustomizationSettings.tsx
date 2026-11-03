import { useState } from 'react';
import { ArrowDown, ArrowUp, LayoutDashboard, RotateCcw, Save, Sidebar as SidebarIcon } from 'lucide-react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import type { WorkspacePreferences, WorkspacePresetId, WorkspacePresetUndo } from './workspacePreferences';
import { SIDEBAR_SECTIONS, WORKSPACE_PRESETS } from './workspacePreferences';

interface Props {
  preferences: WorkspacePreferences;
  ready: boolean;
  issue: string | null;
  undo: WorkspacePresetUndo | null;
  onChange: (next: WorkspacePreferences) => void;
  onApplyPreset: (preset: WorkspacePresetId) => void;
  onUndoPreset: () => void;
  onReset: () => void;
}

const sectionLabels: Record<(typeof SIDEBAR_SECTIONS)[number], string> = {
  tasks: 'Tasks', discovery: 'Discovery', graph: 'Local graph', insights: 'Knowledge health', organization: 'Smart organization', databases: 'Databases', templates: 'Templates',
};

export function WorkspaceCustomizationSettings({ preferences, ready, issue, undo, onChange, onApplyPreset, onUndoPreset, onReset }: Props) {
  const [selectedPreset, setSelectedPreset] = useState<WorkspacePresetId>('writing');
  const [previewPreset, setPreviewPreset] = useState<WorkspacePresetId | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const unsupported = issue?.includes('newer Nodus version') ?? false;
  const disabled = !ready || unsupported;
  const preset = WORKSPACE_PRESETS.find((item) => item.id === previewPreset);
  const undoPreset = WORKSPACE_PRESETS.find((item) => item.id === undo?.preset);
  const sidebarWidthValue = String(preferences.sidebar.width);
  const sidebarWidthOptions = [200, 240, 320, 400, 480].map((width) => ({ value: String(width), label: `${width === 200 ? 'Narrow' : width === 240 ? 'Standard' : width === 320 ? 'Wide' : width === 400 ? 'Extra wide' : 'Maximum'} · ${width} px` }));
  if (!sidebarWidthOptions.some((item) => item.value === sidebarWidthValue)) sidebarWidthOptions.push({ value: sidebarWidthValue, label: `Custom · ${sidebarWidthValue} px` });

  function patch(update: (current: WorkspacePreferences) => WorkspacePreferences) {
    onChange(update(preferences));
  }

  function setSidebarSectionVisible(id: (typeof SIDEBAR_SECTIONS)[number], visible: boolean) {
    patch((current) => ({ ...current, sidebar: { ...current.sidebar, hidden: visible
      ? current.sidebar.hidden.filter((section) => section !== id)
      : [...new Set([...current.sidebar.hidden, id])] } }));
  }

  function moveSection(id: (typeof SIDEBAR_SECTIONS)[number], amount: -1 | 1) {
    const order = [...preferences.sidebar.order];
    const index = order.indexOf(id);
    const nextIndex = index + amount;
    if (index < 0 || nextIndex < 0 || nextIndex >= order.length) return;
    [order[index], order[nextIndex]] = [order[nextIndex]!, order[index]!];
    patch((current) => ({ ...current, sidebar: { ...current.sidebar, order } }));
  }

  return (
    <section className="border-t py-5" aria-labelledby="workspace-settings-title">
      <div className="mb-4 flex items-center gap-2 text-muted-foreground">
        <LayoutDashboard className="size-3.5" />
        <div><h2 id="workspace-settings-title" className="text-[13px] font-semibold text-foreground">Workspace</h2><p className="mt-0.5 text-[11px]">Layout preferences are saved separately for this vault.</p></div>
      </div>

      {issue ? <div role="alert" className="mb-4 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">{issue}</div> : null}

      <div className="flex flex-col gap-3 rounded-md border p-3 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1">
          <label className="mb-1.5 block text-xs font-medium" htmlFor="workspace-preset">Workspace preset</label>
          <Select value={selectedPreset} onValueChange={(value) => setSelectedPreset(value as WorkspacePresetId)} disabled={disabled}>
            <SelectTrigger id="workspace-preset" aria-label="Workspace preset"><SelectValue /></SelectTrigger>
            <SelectContent><SelectGroup>{WORKSPACE_PRESETS.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectGroup></SelectContent>
          </Select>
          <p className="mt-1 text-[11px] text-muted-foreground">Preview the changes first. You can undo the last preset after applying it.</p>
        </div>
        <Button variant="outline" size="sm" disabled={disabled} onClick={() => setPreviewPreset(selectedPreset)}>Preview preset</Button>
        {undo ? <Button variant="ghost" size="sm" onClick={onUndoPreset}><RotateCcw data-icon="inline-start" />Undo {undoPreset?.name ?? 'preset'}</Button> : null}
      </div>

      <div className="mt-5 grid gap-x-8 lg:grid-cols-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2"><SidebarIcon className="size-4 text-muted-foreground" /><h3 className="text-xs font-semibold">Sidebar</h3></div>
          <p className="mt-1 text-[11px] text-muted-foreground">Search, All Notes, and Settings stay available. Optional sections can be restored here.</p>
          <div className="mt-3 flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <label htmlFor="sidebar-width" className="text-xs">Sidebar width</label>
              <Select value={sidebarWidthValue} onValueChange={(value) => patch((current) => ({ ...current, sidebar: { ...current.sidebar, width: Number(value) } }))} disabled={disabled}>
                <SelectTrigger id="sidebar-width" className="w-36" aria-label="Sidebar width"><SelectValue /></SelectTrigger>
                <SelectContent><SelectGroup>{sidebarWidthOptions.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectGroup></SelectContent>
              </Select>
            </div>
            <label className="flex items-start gap-2 text-xs"><Checkbox checked={preferences.sidebar.collapsed} disabled={disabled} onCheckedChange={(checked) => patch((current) => ({ ...current, sidebar: { ...current.sidebar, collapsed: checked === true } }))} /><span><span className="font-medium">Use compact sidebar</span><span className="mt-0.5 block text-[11px] text-muted-foreground">Keep navigation accessible in a narrow icon rail.</span></span></label>
          </div>

          <div className="mt-4 flex flex-col gap-1.5" aria-label="Sidebar sections">
            {preferences.sidebar.order.map((id, index) => <div key={id} className="flex min-h-9 items-center gap-2 rounded-md px-1">
              <Checkbox id={`sidebar-section-${id}`} checked={!preferences.sidebar.hidden.includes(id)} disabled={disabled} onCheckedChange={(checked) => setSidebarSectionVisible(id, checked === true)} />
              <label htmlFor={`sidebar-section-${id}`} className="min-w-0 flex-1 cursor-pointer text-xs">{sectionLabels[id]}</label>
              <Button variant="ghost" size="icon-sm" aria-label={`Move ${sectionLabels[id]} up`} title={`Move ${sectionLabels[id]} up`} disabled={disabled || index === 0} onClick={() => moveSection(id, -1)}><ArrowUp /></Button>
              <Button variant="ghost" size="icon-sm" aria-label={`Move ${sectionLabels[id]} down`} title={`Move ${sectionLabels[id]} down`} disabled={disabled || index === preferences.sidebar.order.length - 1} onClick={() => moveSection(id, 1)}><ArrowDown /></Button>
            </div>)}
          </div>
        </div>

        <div className="mt-6 min-w-0 lg:mt-0">
          <h3 className="text-xs font-semibold">Editor and preview</h3>
          <p className="mt-1 text-[11px] text-muted-foreground">Changing layout never changes the Markdown draft or save state.</p>
          <div className="mt-3 flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3"><label htmlFor="editor-layout" className="text-xs">View</label>
              <Select value={preferences.editor.layout} onValueChange={(value) => patch((current) => ({ ...current, editor: { ...current.editor, layout: value as WorkspacePreferences['editor']['layout'] } }))} disabled={disabled}>
                <SelectTrigger id="editor-layout" className="w-40" aria-label="Editor and preview layout"><SelectValue /></SelectTrigger>
                <SelectContent><SelectGroup><SelectItem value="live">Editor · Live</SelectItem><SelectItem value="source">Editor · Source</SelectItem><SelectItem value="preview">Preview only</SelectItem><SelectItem value="split">Editor and preview</SelectItem></SelectGroup></SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between gap-3"><span className="text-xs">Split balance</span>
              <Select value={String(Math.round(preferences.editor.splitRatio * 100))} onValueChange={(value) => patch((current) => ({ ...current, editor: { ...current.editor, splitRatio: Number(value) / 100 } }))} disabled={disabled || preferences.editor.layout !== 'split'}>
                <SelectTrigger className="w-40" aria-label="Editor and preview split balance"><SelectValue /></SelectTrigger>
                <SelectContent><SelectGroup><SelectItem value="40">Editor 40% · Preview 60%</SelectItem><SelectItem value="50">Even split · 50/50</SelectItem><SelectItem value="60">Editor 60% · Preview 40%</SelectItem></SelectGroup></SelectContent>
              </Select>
            </div>
            <label className="flex items-start gap-2 text-xs"><Checkbox checked={preferences.editor.width === 'full'} disabled={disabled} onCheckedChange={(checked) => patch((current) => ({ ...current, editor: { ...current.editor, width: checked === true ? 'full' : 'comfortable' } }))} /><span><span className="font-medium">Use full writing width</span><span className="mt-0.5 block text-[11px] text-muted-foreground">Otherwise keep the current comfortable reading column.</span></span></label>
          </div>

          <Separator className="my-4" />
          <h3 className="text-xs font-semibold">Note panels</h3>
          <p className="mt-1 text-[11px] text-muted-foreground">These panels appear below the editor content.</p>
          <div className="mt-3 flex flex-col gap-3">
            <PanelCheckbox id="panel-backlinks" label="Backlinks and outgoing links" checked={preferences.panels.backlinks} disabled={disabled} onChange={(value) => patch((current) => ({ ...current, panels: { ...current.panels, backlinks: value } }))} />
            <PanelCheckbox id="panel-relation-backlinks" label="Relation backlinks" checked={preferences.panels.relationBacklinks} disabled={disabled} onChange={(value) => patch((current) => ({ ...current, panels: { ...current.panels, relationBacklinks: value } }))} />
            <PanelCheckbox id="panel-related-notes" label="Related notes" checked={preferences.panels.relatedNotes} disabled={disabled} onChange={(value) => patch((current) => ({ ...current, panels: { ...current.panels, relatedNotes: value } }))} />
          </div>
        </div>
      </div>

      <Separator className="my-5" />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-[60ch] text-[11px] text-muted-foreground">Workspace reset restores this vault’s sidebar, editor, and panel layout. It does not change notes or your global theme.</p>
        <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
          <AlertDialogTrigger asChild><Button variant="outline" size="sm" disabled={disabled}>Reset workspace</Button></AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader><AlertDialogTitle>Reset this workspace?</AlertDialogTitle><AlertDialogDescription>This restores default sidebar, editor, and panel settings for this vault. Notes, the global theme, and other vault settings stay unchanged.</AlertDialogDescription></AlertDialogHeader>
            <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={onReset}>Reset workspace</AlertDialogAction></AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      <Dialog open={previewPreset !== null} onOpenChange={(open) => { if (!open) setPreviewPreset(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Preview {preset?.name ?? 'workspace'} layout</DialogTitle><DialogDescription>{preset?.description ?? 'Review these workspace changes before applying them.'}</DialogDescription></DialogHeader>
          <ul className="flex flex-col gap-2 rounded-md border p-3 text-xs">{preset?.changes.map((change) => <li key={change} className="flex items-start gap-2"><span className="mt-1 size-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />{change}</li>)}</ul>
          <p className="text-[11px] text-muted-foreground">Your previous workspace layout will be saved so you can undo this preset.</p>
          <DialogFooter><Button variant="outline" onClick={() => setPreviewPreset(null)}>Cancel</Button><Button disabled={disabled || previewPreset === null} onClick={() => { if (previewPreset !== null) onApplyPreset(previewPreset); setPreviewPreset(null); }}><Save data-icon="inline-start" />Apply preset</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function PanelCheckbox({ id, label, checked, disabled, onChange }: { id: string; label: string; checked: boolean; disabled: boolean; onChange: (value: boolean) => void }) {
  return <label htmlFor={id} className="flex items-center gap-2 text-xs"><Checkbox id={id} checked={checked} disabled={disabled} onCheckedChange={(value) => onChange(value === true)} />{label}</label>;
}
