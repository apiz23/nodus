import type { ReactNode } from 'react';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

/** Inline feedback stays with the operation; retry is opt-in for safe reads. */
export function FeedbackMessage({ children, tone = 'error', onRetry, retryLabel = 'Retry', pending = false, className }: {
  children: ReactNode; tone?: 'error' | 'success'; onRetry?: () => void; retryLabel?: string; pending?: boolean; className?: string;
}) {
  return <div role={tone === 'error' ? 'alert' : 'status'} aria-atomic="true" className={cn('flex min-w-0 flex-wrap items-start gap-2 rounded-md border p-3 text-sm', tone === 'error' ? 'border-destructive/30 bg-destructive/5 text-destructive' : 'border-success/20 bg-success/5 text-foreground', className)}>
    {tone === 'error' ? <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> : <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />}
    <span className="min-w-0 flex-1 break-words">{children}</span>
    {onRetry ? <Button type="button" variant="outline" size="xs" disabled={pending} onClick={onRetry}>{pending ? 'Retrying…' : retryLabel}</Button> : null}
  </div>;
}

export function LoadingState({ children }: { children: ReactNode }) {
  return <p role="status" aria-live="polite" className="min-h-12 py-4 text-sm text-muted-foreground">{children}</p>;
}

export function EmptyState({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return <section className="flex flex-col items-center gap-2 px-4 py-8 text-center"><h2 className="text-sm font-medium">{title}</h2><p className="max-w-prose text-sm text-muted-foreground">{children}</p>{action ? <div className="mt-2">{action}</div> : null}</section>;
}
