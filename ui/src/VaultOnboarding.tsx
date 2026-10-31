import { useState } from 'react';
import { AlertCircle, FolderOpen, FolderPlus, HardDrive } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { UiVaultSetupState } from '../../src/ui-server/dto';

interface VaultOnboardingProps {
  setup: UiVaultSetupState;
  error: string | null;
  busy: boolean;
  onCreateDefault: () => void;
  onBrowseExisting: () => void;
  onOpenPath: (path: string) => void;
}

export function VaultOnboarding({ setup, error, busy, onCreateDefault, onBrowseExisting, onOpenPath }: VaultOnboardingProps) {
  const [path, setPath] = useState(setup.savedVaultPath ?? '');

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4 py-8 text-foreground">
      <section className="w-full max-w-xl" aria-labelledby="vault-onboarding-title">
        <div className="mb-7 flex size-10 items-center justify-center rounded-lg bg-primary text-base font-semibold text-primary-foreground" aria-hidden="true">N</div>
        <h1 id="vault-onboarding-title" className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Choose your Nodus vault
        </h1>
        <p className="mt-3 max-w-[65ch] text-sm leading-relaxed text-muted-foreground">{setup.message}</p>

        {setup.savedVaultPath ? (
          <div className="mt-4 rounded-md border bg-muted/30 px-3 py-2.5">
            <div className="text-xs font-medium">Last selected folder</div>
            <div className="mt-1 break-all font-mono text-[11px] text-muted-foreground">{setup.savedVaultPath}</div>
          </div>
        ) : null}

        <div className="mt-7 space-y-4">
          <div className="rounded-lg border p-4">
            <div className="flex items-start gap-3">
              <FolderPlus className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-medium">Start with the default vault</h2>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Use Nodus’s default local folder. It will be created only after you choose this option.
                </p>
                <Button className="mt-3" size="sm" onClick={onCreateDefault} disabled={busy}>
                  {busy ? 'Opening…' : 'Use default vault'}
                </Button>
              </div>
            </div>
          </div>

          <div className="rounded-lg border p-4">
            <div className="flex items-start gap-3">
              <HardDrive className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-medium">Open an existing folder</h2>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  A vault is a regular folder containing Markdown notes and Nodus database files. If you select an empty folder, Nodus will use it as a new empty vault.
                </p>
                <div className="mt-3 space-y-2">
                  <label htmlFor="onboarding-vault-path" className="text-xs font-medium">Folder path</label>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Input
                      id="onboarding-vault-path"
                      value={path}
                      onChange={(event) => setPath(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && path.trim() !== '' && !busy) {
                          event.preventDefault();
                          onOpenPath(path.trim());
                        }
                      }}
                      placeholder="Choose or enter an absolute folder path"
                      autoComplete="off"
                      spellCheck={false}
                      className="min-w-0 font-mono text-xs"
                      disabled={busy}
                    />
                    <Button type="button" variant="outline" size="sm" onClick={onBrowseExisting} disabled={busy}>
                      <FolderOpen data-icon="inline-start" /> Browse
                    </Button>
                    <Button type="button" size="sm" onClick={() => onOpenPath(path.trim())} disabled={busy || path.trim() === ''}>
                      Open folder
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {error ? (
          <div className="mt-4 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive" role="alert">
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        ) : null}

        <p className="mt-5 text-[11px] leading-relaxed text-muted-foreground">
          Your notes stay in the selected folder as ordinary files. Nodus stores only the last selected folder in a separate per-user application preference.
        </p>
      </section>
    </main>
  );
}
