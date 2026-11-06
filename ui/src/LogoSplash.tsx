import { useEffect, useRef } from 'react';
import './logo-splash.css';

type LogoSplashProps = {
  onDone?: () => void;
};

/** A one-shot, reduced-motion-aware animation of Nodus's existing mark. */
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
          className="nodus-logo-splash__frame"
          d="M7.5 23.5 16 7.5l8.5 16H7.5Z"
          pathLength="1"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        <path
          className="nodus-logo-splash__measure"
          d="M11.5 18.2h9"
          pathLength="1"
          stroke="currentColor"
          strokeWidth="1.8"
          opacity=".38"
        />
        <circle className="nodus-logo-splash__node nodus-logo-splash__node--top" cx="16" cy="7.5" r="2.4" fill="currentColor" />
        <circle className="nodus-logo-splash__node nodus-logo-splash__node--left" cx="7.5" cy="23.5" r="2.4" fill="currentColor" />
        <circle className="nodus-logo-splash__node nodus-logo-splash__node--right" cx="24.5" cy="23.5" r="2.4" fill="currentColor" />
        <circle
          className="nodus-logo-splash__signal"
          cx="16"
          cy="18.2"
          r="1.8"
          fill="var(--success)"
          onAnimationEnd={(event) => {
            if (event.animationName !== 'nodus-logo-snap' || completionTimeoutRef.current !== null) return;
            completionTimeoutRef.current = window.setTimeout(complete, 2000);
          }}
        />
      </svg>
    </div>
  );
}
