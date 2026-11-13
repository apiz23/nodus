import type { SVGProps } from 'react';

const LOOP_PATH = 'M5.5 16C8.7 7.5 12.6 7.5 16 16C19.4 24.5 23.3 24.5 26.5 16C23.3 7.5 19.4 7.5 16 16C12.6 24.5 8.7 24.5 5.5 16';

/** Nodus mark: a linked, continuous path for portable notes and their connections. */
export function NodusMark({ accent = true, ...props }: SVGProps<SVGSVGElement> & { accent?: boolean }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden="true" {...props}>
      <path d={LOOP_PATH} stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      {accent ? <path d="M14.7 14.3C15.1 14.7 15.4 15.2 16 16C16.6 16.8 16.9 17.3 17.3 17.7" stroke="var(--success)" strokeWidth="3.1" strokeLinecap="round" /> : null}
    </svg>
  );
}

export { LOOP_PATH as NODUS_LOOP_PATH };
