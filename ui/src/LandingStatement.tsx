import { useEffect, useRef } from 'react';

/** Native-scroll ink reveal. The text stays above the moving ink edge. */
export function LandingStatement() {
  const section = useRef<HTMLElement>(null);
  useEffect(() => {
    const element = section.current;
    if (!element) return;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0;
    const update = () => {
      frame = 0;
      if (media.matches) {
        delete element.dataset.scrollEnabled;
        element.style.removeProperty('--ink-radius');
        return;
      }
      element.dataset.scrollEnabled = 'true';
      const rect = element.getBoundingClientRect();
      const travel = Math.max(1, rect.height - window.innerHeight);
      const progress = Math.min(1, Math.max(0, -rect.top / travel));
      element.style.setProperty('--ink-radius', `${(progress * 150).toFixed(2)}vmax`);
    };
    const queue = () => { if (!frame) frame = requestAnimationFrame(update); };
    update();
    window.addEventListener('scroll', queue, { passive: true });
    window.addEventListener('resize', queue);
    media.addEventListener('change', queue);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', queue);
      window.removeEventListener('resize', queue);
      media.removeEventListener('change', queue);
    };
  }, []);

  const words = <><span>Start with a note.</span><span>Make it your own.</span></>;
  return <section ref={section} className="nodus-ink-statement" aria-labelledby="statement-title">
    <div className="nodus-ink-stage">
      <div className="nodus-ink-ground" aria-hidden="true" />
      <div className="nodus-ink-copy"><p className="nodus-ink-eyebrow">Your notes. Your projects. Your local workspace.</p><h2 id="statement-title">{words}</h2></div>
    </div>
  </section>;
}
