import { useEffect, useRef } from 'react';
import './logo-splash.css';
import { NODUS_LOOP_PATH } from './NodusMark';

type LogoSplashProps = {
  onDone?: () => void;
};

/** A one-shot, reduced-motion-aware animation of Nodus's linked-loop mark. */
export function LogoSplash({ onDone }: LogoSplashProps) {
  const onDoneRef = useRef(onDone);
  const completedRef = useRef(false);
  const completionTimeoutRef = useRef<number | null>(null);
  onDoneRef.current = onDone;

  const complete = () => {
    if (completedRef.current) return;
    completedRef.current = true;
    onDoneRef.current?.();
  };

  useEffect(() => {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (reducedMotion) {
      complete();
    }

    return () => {
      if (completionTimeoutRef.current !== null) {
        window.clearTimeout(completionTimeoutRef.current);
      }
    };
  }, []);

  return (
    <div className="nodus-logo-splash" aria-hidden="false">
      <svg
        className="nodus-logo-splash__mark"
        viewBox="0 0 32 32"
        role="img"
        aria-label="Nodus"
        fill="none"
      >
        <path
          className="nodus-logo-splash__loop"
          d={NODUS_LOOP_PATH}
          pathLength="1"
          stroke="currentColor"
          strokeWidth="2.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          className="nodus-logo-splash__signal"
          d="M14.7 14.3C15.1 14.7 15.4 15.2 16 16C16.6 16.8 16.9 17.3 17.3 17.7"
          fill="none"
          stroke="var(--success)"
          strokeWidth="3.1"
          strokeLinecap="round"
          pathLength="1"
          onAnimationEnd={(event) => {
            if (event.animationName !== 'nodus-logo-connect' || completionTimeoutRef.current !== null) return;
            completionTimeoutRef.current = window.setTimeout(complete, 2000);
          }}
        />
      </svg>
    </div>
  );
}
