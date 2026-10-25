import { FileText } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PageIconProps {
  icon: string | null;
  className?: string;
  fallbackClassName?: string;
}

export function PageIcon({ icon, className, fallbackClassName }: PageIconProps) {
  if (icon !== null) {
    return (
      <span
        aria-hidden="true"
        className={cn('inline-flex shrink-0 items-center justify-center leading-none', className)}
      >
        {icon}
      </span>
    );
  }

  return (
    <FileText
      aria-hidden="true"
      className={cn('size-4 shrink-0 text-muted-foreground', fallbackClassName)}
    />
  );
}
