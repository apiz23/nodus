import type { ReactNode } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  CloudOff,
  Folder,
  FolderOpen,
  Moon,
  RefreshCw,
  Sun,
} from 'lucide-react';
import type { UiVaultStatus } from '../../src/ui-server/dto';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { BackupRestoreSection } from './BackupRestoreSection';
import { SidebarToggle } from './SidebarToggle';

interface SettingsViewProps {
  status: UiVaultStatus | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  onPickVault: () => void;
  picking: boolean;
  vaultPathDraft: string;
  onVaultPathDraftChange: (value: string) => void;
  onOpenVault: () => void;
  openingVault: boolean;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  onRestored: () => void;
  onVaultWorkChange: (active: boolean) => void;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="border-t py-5">
      <div className="mb-3 flex items-center gap-2 text-muted-foreground">
        {icon}
        <h2 className="text-[13px] font-semibold text-foreground">{title}</h2>
      </div>
      {children}
    </section>
  );
}

export function SettingsView({
  status,
  loading,
  error,
  onRefresh,
  onPickVault,
  picking,
  vaultPathDraft,
  onVaultPathDraftChange,
  onOpenVault,
  openingVault,
  theme,
  onToggleTheme,
  onRestored,
  onVaultWorkChange,
  sidebarCollapsed,
  onToggleSidebar,
}: SettingsViewProps) {
  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden" aria-label="Settings">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b px-4 py-4 sm:px-6">
        <div className="flex min-w-0 items-start gap-2">
          <SidebarToggle collapsed={sidebarCollapsed} onToggle={onToggleSidebar} />
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
            <p className="mt-1 max-w-[66ch] text-xs leading-relaxed text-muted-foreground">
              Local vault information, storage health, and the honest sync status.
            </p>
          </div>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onRefresh} disabled={loading}>
          <RefreshCw className={loading ? 'animate-spin' : undefined} data-icon="inline-start" />
          {loading ? 'Refreshing…' : 'Refresh'}
        </Button>
      </header>

      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto w-full max-w-6xl px-4 pb-12 sm:px-6">
          {error === null ? null : (
            <div
              className="mt-4 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-2.5 py-2 text-xs text-destructive"
              role="alert"
            >
              <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {loading && status === null ? (
            <div className="grid gap-8 py-6 lg:grid-cols-2">
              <Skeleton className="h-56" />
              <Skeleton className="h-56" />
            </div>
          ) : (
            <div className="grid gap-x-10 lg:grid-cols-2">
              <div>
                <Section title="Local vault" icon={<Folder className="size-3.5" />}>
                  <dl className="space-y-2.5">
                    <div className="grid grid-cols-[112px_minmax(0,1fr)] gap-3">
                      <dt className="text-[11px] text-muted-foreground">Name</dt>
                      <dd className="truncate text-xs">{status?.vault.name ?? 'Loading…'}</dd>
                    </div>
                    <div className="grid grid-cols-[112px_minmax(0,1fr)] gap-3">
                      <dt className="text-[11px] text-muted-foreground">Path</dt>
                      <dd className="truncate font-mono text-[10.5px]" title={status?.vault.path}>
                        {status?.vault.path ?? 'Waiting for local API'}
                      </dd>
                    </div>
                    <div className="grid grid-cols-[112px_minmax(0,1fr)] gap-3">
                      <dt className="text-[11px] text-muted-foreground">Notes</dt>
                      <dd className="text-xs">{status === null ? '—' : status.counts.notes}</dd>
                    </div>
                    <div className="grid grid-cols-[112px_minmax(0,1fr)] gap-3">
                      <dt className="text-[11px] text-muted-foreground">Definitions</dt>
                      <dd className="text-xs">{status === null ? '—' : status.counts.databases}</dd>
                    </div>
                  </dl>
                  <div className="mt-3 space-y-2">
                    <label
                      className="text-[11px] font-medium text-muted-foreground"
                      htmlFor="vault-path"
                    >
                      Vault folder
                    </label>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <Input
                        id="vault-path"
                        value={vaultPathDraft}
                        onChange={(event) => onVaultPathDraftChange(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            onOpenVault();
                          }
                        }}
                        placeholder="C:\path\to\your\vault"
                        spellCheck={false}
                        className="h-8 font-mono text-[11px]"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="shrink-0"
                        onClick={onPickVault}
                        disabled={picking || openingVault}
                      >
                        <FolderOpen data-icon="inline-start" />
                        {picking ? 'Opening…' : 'Browse…'}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        className="shrink-0"
                        onClick={onOpenVault}
                        disabled={openingVault || picking || vaultPathDraft.trim() === ''}
                      >
                        {openingVault ? 'Opening…' : 'Use folder'}
                      </Button>
                    </div>
                  </div>
                  <p className="mt-3 max-w-[62ch] text-[11px] leading-relaxed text-muted-foreground">
                    Path is sent only to the local Nodus server and must be an absolute folder. The
                    choice applies for this server session. Set <code>NODUS_VAULT</code> to make it
                    permanent. Folders outside the allowed roots are rejected; set{' '}
                    <code>NODUS_VAULT_ROOTS</code> (a <code>PATH</code>-delimited list) to allow
                    more roots.
                  </p>
                </Section>

                <Section
                  title="Storage health"
                  icon={
                    status !== null && status.health.issues.length === 0 ? (
                      <CheckCircle2 className="size-3.5" />
                    ) : (
                      <AlertCircle className="size-3.5" />
                    )
                  }
                >
                  {status === null ? (
                    <p className="text-xs text-muted-foreground">Checking the vault…</p>
                  ) : status.health.issues.length === 0 ? (
                    <div className="flex items-center gap-2 text-xs text-success">
                      <CheckCircle2 className="size-3.5" />
                      No storage issues detected.
                    </div>
                  ) : (
                    <>
                      <p className="mb-3 text-[11px] text-muted-foreground">
                        {status.health.issues.length}{' '}
                        {status.health.issues.length === 1 ? 'issue' : 'issues'} found. Health checks
                        are read-only.
                      </p>
                      <ul className="space-y-2">
                        {status.health.issues.map((issue) => (
                          <li
                            key={`${issue.code}-${issue.path}`}
                            className="rounded-md border bg-muted/30 px-3 py-2"
                          >
                            <div className="flex items-center gap-2">
                              <Badge variant="destructive" className="font-mono text-[9px]">
                                {issue.code}
                              </Badge>
                              <span className="truncate font-mono text-[10px] text-muted-foreground">
                                {issue.path}
                              </span>
                            </div>
                            <p className="mt-1.5 text-[11px] text-muted-foreground">
                              {issue.message}
                            </p>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </Section>
              </div>

              <div>
                <Section title="Sync" icon={<CloudOff className="size-3.5" />}>
                  <div className="flex items-start gap-2.5 rounded-md border bg-muted/30 px-3 py-2.5">
                    <span className="mt-1 size-1.5 shrink-0 rounded-full bg-muted-foreground" />
                    <div>
                      <div className="text-xs font-semibold">{status?.sync.label ?? 'Not connected'}</div>
                      <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                        {status?.sync.detail ??
                          'Experimental sync exists but is not connected to a relay or wired into this UI. This workspace is local only.'}
                      </p>
                    </div>
                  </div>
                  <p className="mt-3 max-w-[62ch] text-[11px] leading-relaxed text-muted-foreground">
                    This UI does not call relay push/pull endpoints and does not load relay admin
                    tokens. An experimental sync client and relay implementation exist, but they
                    are not connected to a relay or part of the normal workflow — cross-device sync
                    is not a user-ready feature.
                  </p>
                </Section>

                <Section
                  title="Appearance"
                  icon={theme === 'light' ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
                >
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <div className="text-xs font-medium">
                        {theme === 'light' ? 'Light theme' : 'Dark theme'}
                      </div>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        Theme is stored in this browser only.
                      </p>
                    </div>
                    <Button type="button" variant="outline" size="sm" onClick={onToggleTheme}>
                      {theme === 'light' ? <Moon data-icon="inline-start" /> : <Sun data-icon="inline-start" />}
                      Use {theme === 'light' ? 'dark' : 'light'}
                    </Button>
                  </div>
                  <Separator className="my-4" />
                  <div className="flex items-center justify-between gap-4 text-[11px] text-muted-foreground">
                    <span>Transport</span>
                    <span>Localhost only</span>
                  </div>
                </Section>
              </div>

              <div className="lg:col-span-2">
                <BackupRestoreSection onRestored={onRestored} onActivityChange={onVaultWorkChange} />
              </div>
            </div>
          )}
        </div>
      </ScrollArea>
    </section>
  );
}
