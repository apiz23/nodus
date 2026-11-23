import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
  type SVGProps,
} from 'react';
import {
  Archive,
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCircle2,
  CloudOff,
  Columns3,
  CornerDownLeft,
  Database,
  FileJson,
  FileText,
  FolderOpen,
  HardDrive,
  Link2,
  ListChecks,
  LockKeyhole,
  Menu,
  Moon,
  MousePointer2,
  Network,
  Search,
  ShieldCheck,
  Sun,
  WifiOff,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { LandingStatement } from './LandingStatement';
import { NodusMark } from './NodusMark';
import { readWorkspaceTheme, saveGlobalTheme, type WorkspaceTheme } from './workspacePreferences';
import './landing.css';

const GITHUB_URL = 'https://github.com/apiz23/nodus';
const WORKSPACE_PATH = '/app';

const navLinks = [
  { href: '#features', label: 'Features' },
  { href: '#databases', label: 'Databases' },
  { href: '#philosophy', label: 'Your files' },
];

function GithubMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0 0 22 12.017C22 6.484 17.522 2 12 2Z" />
    </svg>
  );
}

function Wordmark() {
  return (
    <a href="/" className="nl-wordmark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Nodus home">
      <NodusMark className="size-7" />
      <span>Nodus</span>
    </a>
  );
}

function NavLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} className="nl-nav-link focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {children}
    </a>
  );
}

function LandingNav() {
  const [theme, setTheme] = useState<WorkspaceTheme>(() => {
    try { return readWorkspaceTheme(window.localStorage); } catch { return 'light'; }
  });
  useEffect(() => { document.documentElement.classList.toggle('dark', theme === 'dark'); }, [theme]);
  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    try { saveGlobalTheme(window.localStorage, next); } catch { /* Theme still works for this visit. */ }
  };
  return (
    <header className="nl-nav">
      <div className="nl-nav-inner">
        <Wordmark />
        <nav aria-label="Primary" className="nl-nav-links">
          {navLinks.map((link) => <NavLink key={link.href} href={link.href}>{link.label}</NavLink>)}
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            className="nl-nav-link focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            GitHub <ArrowUpRight className="size-3" aria-hidden="true" />
          </a>
        </nav>
        <div className="nl-nav-actions">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="nl-theme-button"
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            onClick={toggleTheme}
          >
            {theme === 'dark' ? <Sun /> : <Moon />}
          </Button>
          <Button asChild className="nl-nav-cta hidden sm:inline-flex">
            <a href={WORKSPACE_PATH}>
              Open workspace
              <ArrowRight data-icon="inline-end" aria-hidden="true" />
            </a>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="icon" className="nl-theme-button lg:hidden" aria-label="Open menu">
                <Menu />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56 p-1.5">
              {navLinks.map((link) => (
                <DropdownMenuItem key={link.href} asChild className="min-h-11 gap-2 px-2.5">
                  <a href={link.href}>{link.label}</a>
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild className="min-h-11 gap-2 px-2.5">
                <a href={GITHUB_URL} target="_blank" rel="noreferrer">
                  GitHub <ArrowUpRight className="ml-auto size-3.5" aria-hidden="true" />
                </a>
              </DropdownMenuItem>
              <DropdownMenuItem asChild className="min-h-11 gap-2 px-2.5">
                <a href={WORKSPACE_PATH}>
                  Open workspace <ArrowRight className="ml-auto size-3.5" aria-hidden="true" />
                </a>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}

/* -------------------------------------------------------------------------
   Hooks
   ------------------------------------------------------------------------- */

function useRevealOnScroll() {
  useEffect(() => {
    const elements = Array.from(document.querySelectorAll<HTMLElement>('[data-reveal]'));
    if (elements.length === 0) return;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');

    if (media.matches || !('IntersectionObserver' in window)) {
      elements.forEach((element) => element.classList.add('is-visible'));
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.14, rootMargin: '0px 0px -8% 0px' });

    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, []);
}

function useHeroMotion(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const element = ref.current;
    if (element === null) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    const finePointer = window.matchMedia('(pointer: fine)');
    let frame = 0;
    let x = 0;
    let y = 0;

    const apply = () => {
      frame = 0;
      element.style.setProperty('--hero-x', x.toFixed(4));
      element.style.setProperty('--hero-y', y.toFixed(4));
      element.style.setProperty('--hero-mx', `${((x * 0.5 + 0.5) * 100).toFixed(2)}%`);
      element.style.setProperty('--hero-my', `${((y * 0.5 + 0.5) * 100).toFixed(2)}%`);
    };
    const queue = () => { if (!frame) frame = requestAnimationFrame(apply); };
    const onPointerMove = (event: PointerEvent) => {
      if (reduce.matches || !finePointer.matches) return;
      const rect = element.getBoundingClientRect();
      x = Math.max(-1, Math.min(1, ((event.clientX - rect.left) / rect.width - 0.5) * 2));
      y = Math.max(-1, Math.min(1, ((event.clientY - rect.top) / rect.height - 0.5) * 2));
      queue();
    };
    const reset = () => { x = 0; y = 0; queue(); };
    const onMotionChange = () => { if (reduce.matches) reset(); };

    element.addEventListener('pointermove', onPointerMove);
    element.addEventListener('pointerleave', reset);
    reduce.addEventListener('change', onMotionChange);
    return () => {
      cancelAnimationFrame(frame);
      element.removeEventListener('pointermove', onPointerMove);
      element.removeEventListener('pointerleave', reset);
      reduce.removeEventListener('change', onMotionChange);
    };
  }, [ref]);
}

function useRailProgress(
  sectionRef: RefObject<HTMLElement | null>,
  trackRef: RefObject<HTMLDivElement | null>,
) {
  useEffect(() => {
    const section = sectionRef.current;
    const track = trackRef.current;
    if (section === null || track === null) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0;

    const update = () => {
      frame = 0;
      if (reduce.matches) {
        section.style.removeProperty('--rail-progress');
        section.style.removeProperty('--rail-x');
        return;
      }
      const rect = section.getBoundingClientRect();
      const travel = Math.max(1, rect.height - window.innerHeight);
      const progress = Math.min(1, Math.max(0, -rect.top / travel));
      const shift = Math.max(0, track.scrollWidth - window.innerWidth);
      section.style.setProperty('--rail-progress', progress.toFixed(4));
      section.style.setProperty('--rail-x', `${(-progress * shift).toFixed(2)}px`);
    };
    const queue = () => { if (!frame) frame = requestAnimationFrame(update); };

    update();
    window.addEventListener('scroll', queue, { passive: true });
    window.addEventListener('resize', queue);
    reduce.addEventListener('change', queue);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', queue);
      window.removeEventListener('resize', queue);
      reduce.removeEventListener('change', queue);
    };
  }, [sectionRef, trackRef]);
}

/* -------------------------------------------------------------------------
   Small visual components
   ------------------------------------------------------------------------- */

function BrowserWindow({
  title,
  state = 'local',
  className,
  children,
}: {
  title: string;
  state?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn('nl-window', className)}>
      <div className="nl-window-bar">
        <span className="nl-window-dots" aria-hidden="true"><i /><i /><i /></span>
        <span className="nl-window-title">{title}</span>
        <span className="nl-window-state">{state}</span>
      </div>
      {children}
    </div>
  );
}

function NoteCard() {
  return (
    <div className="nl-mini-card nl-note-card">
      <div className="nl-note-head">
        <FileText className="size-3.5" aria-hidden="true" />
        Research index
        <span className="nl-note-pill">note</span>
      </div>
      <p className="nl-note-kicker"># research-index</p>
      <p className="nl-note-title">A map of local-first tools.</p>
      <div className="nl-note-lines" aria-hidden="true"><span /><span /><span /></div>
      <span className="nl-note-link">[[product-brief]]</span>
      <div className="nl-note-tags"><span>#research</span><span>#reading</span></div>
    </div>
  );
}

function CommandPalette() {
  return (
    <div className="nl-palette">
      <div className="nl-palette-input">
        <Search className="size-3.5" aria-hidden="true" />
        Search notes and commands…
        <kbd>⌘K</kbd>
      </div>
      <ul className="nl-palette-list">
        <li><FileText className="size-3" aria-hidden="true" />A quieter launch <em>note</em></li>
        <li><Database className="size-3" aria-hidden="true" />Launch notebook <em>database</em></li>
        <li><Network className="size-3" aria-hidden="true" />Local graph <em>view</em></li>
      </ul>
      <div className="nl-palette-foot"><CornerDownLeft className="inline size-2.5" aria-hidden="true" /> open · esc close</div>
    </div>
  );
}

function SavedToast() {
  return (
    <div className="nl-toast">
      <span className="nl-toast-icon"><Check className="size-3" aria-hidden="true" /></span>
      <span>
        <strong>Saved to your vault</strong>
        <span>just now · local</span>
      </span>
    </div>
  );
}

function MiniGraph() {
  return (
    <div className="nl-graph-card">
      <div className="nl-graph-head"><Network className="size-3" aria-hidden="true" /> Local graph <span>12 notes</span></div>
      <svg viewBox="0 0 240 132" fill="none" aria-hidden="true">
        <g stroke="currentColor" strokeOpacity="0.16">
          <path d="M50 34 Q86 52 120 66" />
          <path d="M120 66 Q153 44 191 30" />
          <path d="M120 66 Q152 88 188 103" />
          <path d="M120 66 Q86 91 52 104" />
          <path d="M50 34 Q55 68 52 104" />
          <path d="M191 30 Q197 68 188 103" />
        </g>
        <path d="M120 66 Q153 44 191 30" className="graph-link-flow" stroke="var(--success)" strokeOpacity="0.7" strokeWidth="1.2" />
        <g fill="var(--success)">
          <circle cx="120" cy="66" r="7" fillOpacity="0.16" className="graph-node-pulse" />
          <circle cx="120" cy="66" r="4.2" />
        </g>
        <g fill="currentColor" fillOpacity="0.7">
          <circle cx="50" cy="34" r="3" />
          <circle cx="191" cy="30" r="3" />
          <circle cx="188" cy="103" r="3" />
          <circle cx="52" cy="104" r="3" />
        </g>
      </svg>
    </div>
  );
}

function CursorChip({ label, moss = false }: { label: string; moss?: boolean }) {
  return (
    <span className={cn('nl-hero-cursor', moss && 'nl-hero-cursor--moss')} aria-hidden="true">
      <MousePointer2 />
      <span>{label}</span>
    </span>
  );
}

function SelectionHandles() {
  return (
    <>
      <span className="nl-handle nl-handle--tl" aria-hidden="true" />
      <span className="nl-handle nl-handle--tr" aria-hidden="true" />
      <span className="nl-handle nl-handle--bl" aria-hidden="true" />
      <span className="nl-handle nl-handle--br" aria-hidden="true" />
      <span className="nl-handle nl-handle--tc" aria-hidden="true" />
      <span className="nl-handle nl-handle--bc" aria-hidden="true" />
    </>
  );
}

function EditorFigure({ compact = false }: { compact?: boolean }) {
  return (
    <figure className={cn('nl-window', compact && 'nl-mobile-preview-window')} aria-label="An example local workspace in Nodus">
      <div className="nl-window-bar">
        <span className="nl-window-dots" aria-hidden="true"><i /><i /><i /></span>
        <span className="nl-window-title">Nodus — A quieter launch</span>
        <span className="nl-window-state">saved</span>
      </div>
      <img
        src="/brand/nodus-editor-light.jpg"
        alt="Nodus showing a Markdown project note, wiki links, tasks, and a note sidebar."
        width={1440}
        height={900}
        fetchPriority="high"
        className="block h-auto w-full dark:hidden"
      />
      <img
        src="/brand/nodus-editor-dark.jpg"
        alt="The Nodus project note in the dark theme."
        width={1440}
        height={900}
        className="hidden h-auto w-full dark:block"
      />
    </figure>
  );
}

/* -------------------------------------------------------------------------
   Hero
   ------------------------------------------------------------------------- */

function Hero({ sectionRef }: { sectionRef: RefObject<HTMLElement | null> }) {
  useHeroMotion(sectionRef);
  return (
    <section ref={sectionRef} className="nl-hero" aria-labelledby="landing-hero-title">
      <div className="nl-hero-floats" aria-hidden="true">
        <div className="nl-float nl-float--editor"><div className="nl-float-in"><div className="nl-float-bob"><EditorFigure /></div></div></div>
        <div className="nl-float nl-float--note"><div className="nl-float-in"><div className="nl-float-bob"><NoteCard /></div></div></div>
        <div className="nl-float nl-float--palette"><div className="nl-float-in"><div className="nl-float-bob"><CommandPalette /></div></div></div>
        <div className="nl-float nl-float--toast"><div className="nl-float-in"><div className="nl-float-bob"><SavedToast /></div></div></div>
        <div className="nl-float nl-float--graph"><div className="nl-float-in"><div className="nl-float-bob"><MiniGraph /></div></div></div>
        <div className="nl-float nl-float--cursor"><div className="nl-float-in"><CursorChip label="writer" moss /></div></div>
      </div>

      <div className="nl-hero-content">
        <p className="nl-hero-note"><span className="nl-dot" aria-hidden="true" />Local-first · No account required</p>
        <h1 id="landing-hero-title" className="nl-hero-title" aria-label="Your local workspace for notes and projects.">
          <span className="nl-title-line">
            <span>Your local <span className="nl-selection">workspace<SelectionHandles /></span></span>
          </span>
          <span className="nl-title-line nl-title-line--sub"><span>for notes <em>and</em> projects.</span></span>
        </h1>
        <p className="nl-hero-sub">
          Write in Markdown, connect your research, and shape flexible databases around the work.
          The vault stays on your disk — readable, portable, and yours.
        </p>
        <div className="nl-hero-actions">
          <Button asChild className="nl-cta h-12">
            <a href={WORKSPACE_PATH}>
              Start writing
              <ArrowRight data-icon="inline-end" aria-hidden="true" />
            </a>
          </Button>
          <Button asChild variant="outline" className="nl-cta nl-cta--outline h-12">
            <a href="#features">
              See how it works
              <ArrowRight data-icon="inline-end" aria-hidden="true" />
            </a>
          </Button>
        </div>
        <p className="nl-hero-meta">Plain Markdown · Portable databases · Your workspace stays yours.</p>
        <div className="nl-mobile-preview">
          <EditorFigure compact />
          <figcaption>An example local workspace. Every row still opens a Markdown note.</figcaption>
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------
   Capabilities
   ------------------------------------------------------------------------- */

function Capabilities() {
  return (
    <section id="features" className="nl-section scroll-mt-20" aria-labelledby="capabilities-title">
      <div className="nl-shell">
        <div className="nl-section-head" data-reveal>
          <div>
            <p className="nl-index">01 — Capabilities</p>
            <h2 id="capabilities-title" className="nl-h2">A workspace with a memory.</h2>
          </div>
          <p className="nl-copy">
            Nodus keeps Markdown as the source of truth and builds the connections around it.
            Write freely, then let the workspace remember where each thought belongs.
          </p>
        </div>

        <div className="nl-cap-grid">
          <article className="nl-cap nl-cap--ink" data-reveal>
            <div className="nl-cap-top">
              <span className="nl-cap-num">01 / WRITE</span>
              <span className="nl-cap-icon"><FileText className="size-4" aria-hidden="true" /></span>
            </div>
            <h3 className="nl-cap-title">Write in Markdown. Keep the links.</h3>
            <p className="nl-cap-copy">
              Notes are plain Markdown with YAML frontmatter and stable IDs. Open them anywhere;
              Nodus adds backlinks, search, and a local graph.
            </p>
            <div className="nl-cap-visual">
              <div className="nl-mock">
                <div className="nl-mock-title"><FileText className="size-3" aria-hidden="true" /> research-index.md</div>
                <span className="nl-mock-line" /><span className="nl-mock-line nl-mock-line--short" />
                <div className="nl-note-link">[[product-brief]]</div>
              </div>
            </div>
            <a className="nl-cap-link" href="#philosophy">Your files, in the open <ArrowUpRight className="size-3.5" aria-hidden="true" /></a>
          </article>

          <article className="nl-cap nl-cap--paper" data-reveal>
            <div className="nl-cap-top">
              <span className="nl-cap-num">02 / STRUCTURE</span>
              <span className="nl-cap-icon"><Database className="size-4" aria-hidden="true" /></span>
            </div>
            <h3 className="nl-cap-title">Structure without a cage.</h3>
            <p className="nl-cap-copy">
              Turn notes into databases with typed properties, saved views, relations, and rollups.
              Every row still opens the Markdown note behind it.
            </p>
            <div className="nl-cap-visual">
              <div className="nl-mock">
                <div className="nl-mock-title"><Database className="size-3" aria-hidden="true" /> launch-notebook</div>
                <table className="nl-mock-table">
                  <thead><tr><th>Note</th><th>Status</th></tr></thead>
                  <tbody>
                    <tr><td>A quieter launch</td><td><span className="nl-mock-pill">in progress</span></td></tr>
                    <tr><td>Reading list</td><td><span className="nl-mock-pill">ready</span></td></tr>
                    <tr><td>Research notes</td><td><span className="nl-mock-pill">ready</span></td></tr>
                  </tbody>
                </table>
              </div>
            </div>
            <a className="nl-cap-link" href="#databases">Explore the workspace <ArrowUpRight className="size-3.5" aria-hidden="true" /></a>
          </article>

          <article className="nl-cap nl-cap--warm" data-reveal>
            <div className="nl-cap-top">
              <span className="nl-cap-num">03 / KEEP</span>
              <span className="nl-cap-icon"><FolderOpen className="size-4" aria-hidden="true" /></span>
            </div>
            <h3 className="nl-cap-title">Yours, on disk.</h3>
            <p className="nl-cap-copy">
              Local vaults, verified backups, portable export. Your work stays usable offline,
              with no account standing between you and the folder.
            </p>
            <div className="nl-cap-visual">
              <div className="nl-mock">
                <div className="nl-tree">
                  <strong>vault/</strong>
                  <span>├── notes/</span>
                  <span>│   ├── research-index.md</span>
                  <span>│   └── product-brief.md</span>
                  <span>├── databases/</span>
                  <span className="is-moss">│   └── reading-list.json</span>
                  <span>└── database-views/</span>
                </div>
              </div>
            </div>
            <a className="nl-cap-link" href="#philosophy">See where it lives <ArrowUpRight className="size-3.5" aria-hidden="true" /></a>
          </article>
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------
   Process
   ------------------------------------------------------------------------- */

interface ProcessStep {
  number: string;
  title: string;
  copy: string;
  sample: string;
  icon: LucideIcon;
  image: { light: string; dark: string; alt: string };
}

const processSteps: ProcessStep[] = [
  {
    number: '01',
    title: 'Capture a note',
    copy: 'Write in plain Markdown. Nodus keeps stable IDs and preserves your frontmatter.',
    sample: 'meeting-notes.md',
    icon: FileText,
    image: {
      light: '/brand/nodus-editor-light.jpg',
      dark: '/brand/nodus-editor-dark.jpg',
      alt: 'A Markdown note in Nodus with tasks, links, and the note sidebar.',
    },
  },
  {
    number: '02',
    title: 'Connect the context',
    copy: 'Link related notes and follow backlinks. Search and the local graph keep the trail visible.',
    sample: '[[product-brief]]',
    icon: Link2,
    image: {
      light: '/brand/nodus-connections-light.jpg',
      dark: '/brand/nodus-connections-dark.jpg',
      alt: 'The Nodus Connections sheet showing backlinks, outgoing links, and related notes.',
    },
  },
  {
    number: '03',
    title: 'Structure what matters',
    copy: 'Add the note to a database, type its properties, and save the view that fits the work.',
    sample: 'Status · Focus · Owner',
    icon: Database,
    image: {
      light: '/brand/nodus-database-light.jpg',
      dark: '/brand/nodus-database-dark.jpg',
      alt: 'A Nodus database table with note-backed records and a Status property.',
    },
  },
];

function StepImage({ step, className }: { step: ProcessStep; className?: string }) {
  return (
    <span className={className}>
      <img src={step.image.light} alt={step.image.alt} width={1440} height={900} loading="lazy" className="block h-full w-full dark:hidden" />
      <img src={step.image.dark} alt={step.image.alt} width={1440} height={900} loading="lazy" className="hidden h-full w-full dark:block" />
    </span>
  );
}

function ProcessShowcase() {
  const [active, setActive] = useState(0);
  const stepRefs = useRef<Array<HTMLElement | null>>([]);

  useEffect(() => {
    if (!('IntersectionObserver' in window)) return;
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const index = Number((entry.target as HTMLElement).dataset.step);
        if (Number.isFinite(index)) setActive(index);
      });
    }, { rootMargin: '-40% 0px -46% 0px', threshold: 0 });
    const elements = stepRefs.current.filter((element): element is HTMLElement => element !== null);
    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, []);

  return (
    <section className="nl-process" aria-labelledby="process-title">
      <div className="nl-shell">
        <div className="nl-process-shell">
          <div className="nl-process-head" data-reveal>
            <p className="nl-index">02 — How it works</p>
            <h2 id="process-title" className="nl-process-title">
              From a thought<br />to a <span className="nl-selection">system.<SelectionHandles /></span>
            </h2>
            <p className="nl-process-sub">
              Start loose. Add structure only where it helps. The note remains Markdown at every step —
              and the system stays visible while you work.
            </p>
          </div>

          <div className="nl-process-grid">
            <div className="nl-process-steps">
              {processSteps.map((step, index) => (
                <article
                  key={step.number}
                  ref={(element) => { stepRefs.current[index] = element; }}
                  data-step={index}
                  className={cn('nl-step', active === index && 'is-active')}
                >
                  <button
                    type="button"
                    className="nl-step-hit"
                    onClick={() => setActive(index)}
                    aria-pressed={active === index}
                    aria-label={`Show step ${step.number}: ${step.title}`}
                  />
                  <span className="nl-step-top">
                    <span className="nl-step-num">{step.number}</span>
                    <span className="nl-step-icon"><step.icon className="size-3.5" aria-hidden="true" /></span>
                  </span>
                  <h3>{step.title}</h3>
                  <p>{step.copy}</p>
                  <span className="nl-step-sample">{step.sample}</span>
                  <span className="nl-step-media">
                    <span className="nl-device nl-device--inline">
                      <span className="nl-device-screen">
                        <StepImage step={step} className="nl-device-img is-active" />
                      </span>
                    </span>
                  </span>
                </article>
              ))}
            </div>

            <div className="nl-process-media">
              <div className="nl-device">
                <div className="nl-device-bar">
                  <span className="nl-window-dots" aria-hidden="true"><i /><i /><i /></span>
                  <span>Nodus — a working example</span>
                </div>
                <div className="nl-device-screen">
                  {processSteps.map((step, index) => (
                    <StepImage key={step.number} step={step} className={cn('nl-device-img', active === index && 'is-active')} />
                  ))}
                </div>
              </div>
              <div className="nl-device-caption">
                {processSteps[active]?.title ?? ''} <span>live example</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------
   Module rail
   ------------------------------------------------------------------------- */

interface RailCard {
  number: string;
  title: string;
  copy: string;
  icon: LucideIcon;
  tone: 'paper' | 'ink' | 'warm';
  visual: 'note' | 'graph' | 'table' | 'views' | 'tasks' | 'backup';
}

const railCards: RailCard[] = [
  {
    number: '01',
    title: 'Notes that stay readable.',
    copy: 'Markdown bodies, YAML frontmatter, tags, aliases, and stable IDs. Open the vault in any editor.',
    icon: FileText,
    tone: 'paper',
    visual: 'note',
  },
  {
    number: '02',
    title: 'Links that come back.',
    copy: 'Wiki links, backlinks, full-text search, and a local graph. Follow the thread without leaving the vault.',
    icon: Link2,
    tone: 'ink',
    visual: 'graph',
  },
  {
    number: '03',
    title: 'Databases made of notes.',
    copy: 'Typed properties and relations layered over Markdown. The record is the note; the database is the view.',
    icon: Database,
    tone: 'paper',
    visual: 'table',
  },
  {
    number: '04',
    title: 'Views that match the work.',
    copy: 'Table, list, gallery, kanban, and calendar. Save the filters and properties each project needs.',
    icon: Columns3,
    tone: 'warm',
    visual: 'views',
  },
  {
    number: '05',
    title: 'Tasks from the writing.',
    copy: 'A derived dashboard reads tasks from your notes. Completion writes back to the Markdown source.',
    icon: ListChecks,
    tone: 'paper',
    visual: 'tasks',
  },
  {
    number: '06',
    title: 'Backups you can prove.',
    copy: 'Verified backup and restore, portable export, and a vault you can move with the filesystem.',
    icon: Archive,
    tone: 'ink',
    visual: 'backup',
  },
];

function RailVisual({ kind }: { kind: RailCard['visual'] }) {
  if (kind === 'note') {
    return (
      <div className="nl-mock">
        <div className="nl-mock-title"><FileText className="size-3" aria-hidden="true" /> product-brief.md</div>
        <span className="nl-mock-line" /><span className="nl-mock-line" /><span className="nl-mock-line nl-mock-line--short" />
      </div>
    );
  }
  if (kind === 'graph') {
    return (
      <div className="nl-mock">
        <div className="nl-mock-title"><Network className="size-3" aria-hidden="true" /> local graph</div>
        <MiniGraph />
      </div>
    );
  }
  if (kind === 'table') {
    return (
      <div className="nl-mock">
        <div className="nl-mock-title"><Database className="size-3" aria-hidden="true" /> launch-notebook</div>
        <table className="nl-mock-table">
          <thead><tr><th>Note</th><th>Status</th></tr></thead>
          <tbody>
            <tr><td>A quieter launch</td><td><span className="nl-mock-pill">in progress</span></td></tr>
            <tr><td>Reading list</td><td><span className="nl-mock-pill">ready</span></td></tr>
          </tbody>
        </table>
      </div>
    );
  }
  if (kind === 'views') {
    return (
      <div className="nl-mock">
        <div className="nl-mock-title"><Columns3 className="size-3" aria-hidden="true" /> saved views</div>
        <div className="nl-view-chips">
          <span>Table</span><span>List</span><span>Gallery</span><span>Kanban</span><span>Calendar</span>
        </div>
      </div>
    );
  }
  if (kind === 'tasks') {
    return (
      <div className="nl-mock">
        <div className="nl-mock-title"><ListChecks className="size-3" aria-hidden="true" /> this week</div>
        <div className="nl-check-row"><span className="nl-check-box is-done"><Check className="size-2" aria-hidden="true" /></span>Map the first writing experience</div>
        <div className="nl-check-row"><span className="nl-check-box" />Test the reading list</div>
        <div className="nl-check-row"><span className="nl-check-box" />Gather notes from the field</div>
      </div>
    );
  }
  return (
    <div className="nl-mock">
      <div className="nl-mock-title"><Archive className="size-3" aria-hidden="true" /> verified backup</div>
      <div className="nl-tree">
        <span><strong>nodus-backup.json</strong></span>
        <span className="is-moss">✓ integrity verified</span>
        <span>restore checked · portable</span>
      </div>
    </div>
  );
}

function ModuleRail() {
  const sectionRef = useRef<HTMLElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  useRailProgress(sectionRef, trackRef);

  return (
    <section ref={sectionRef} id="databases" className="nl-rail-section scroll-mt-20" aria-labelledby="rail-title">
      <div className="nl-rail-sticky">
        <div className="nl-rail-head">
          <div className="nl-rail-head-copy" data-reveal>
            <p className="nl-index">03 — Inside the workspace</p>
            <h2 id="rail-title" className="nl-h2">Every part earns its place.</h2>
            <p className="nl-copy">
              Five views, typed properties, relations, rollups, and a task dashboard derived from your notes.
              All of it sits on top of plain files.
            </p>
          </div>
          <span className="nl-rail-count">06 MODULES · SCROLL</span>
        </div>
        <div className="nl-rail-progress" aria-hidden="true"><div className="nl-rail-progress-track"><span className="nl-rail-progress-fill" /></div></div>
        <div ref={trackRef} className="nl-rail-track">
          {railCards.map((card) => (
            <article key={card.number} className={cn('nl-rail-card', `nl-rail-card--${card.tone}`)}>
              <div className="nl-rail-card-top">
                <span className="nl-rail-num">{card.number}</span>
                <span className="nl-rail-icon"><card.icon className="size-4" aria-hidden="true" /></span>
              </div>
              <h3 className="nl-rail-title">{card.title}</h3>
              <p className="nl-rail-copy">{card.copy}</p>
              <div className="nl-rail-visual"><RailVisual kind={card.visual} /></div>
            </article>
          ))}
        </div>
        <p className="nl-rail-hint" aria-hidden="true">Swipe to explore the workspace →</p>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------
   Value marquee
   ------------------------------------------------------------------------- */

const values = [
  'Plain Markdown',
  'Local by default',
  'No account required',
  'Apache-2.0',
  'No telemetry',
  'Portable databases',
  'Offline editing',
  'Files you own',
];

function ValueMarquee() {
  return (
    <div className="nl-marquee" aria-label="Nodus principles">
      <div className="nl-marquee-track">
        <ul className="nl-marquee-copy">
          {values.map((value) => <li key={value}>{value}</li>)}
        </ul>
        <ul className="nl-marquee-copy" aria-hidden="true">
          {values.map((value) => <li key={value}>{value}</li>)}
        </ul>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------
   Ownership / files
   ------------------------------------------------------------------------- */

function FilesSection() {
  return (
    <section id="philosophy" className="nl-files scroll-mt-20" aria-labelledby="files-title">
      <div className="nl-shell">
        <div className="nl-files-grid">
          <div className="nl-files-copy" data-reveal>
            <p className="nl-index">04 — Your files</p>
            <h2 id="files-title" className="nl-h2">
              Nothing between you and your <span className="nl-selection">files.<SelectionHandles /></span>
            </h2>
            <p className="nl-copy">
              Your vault is a folder of ordinary Markdown, portable database definitions, and saved views.
              Read it in any editor, move it with your filesystem, and back it up on your terms.
            </p>

            <div className="nl-files-facts">
              <div className="nl-fact">
                <h3><CheckCircle2 className="size-3.5 text-success" aria-hidden="true" />Available today</h3>
                <p>Local vaults, Markdown editing, verified backups, and portable database views.</p>
              </div>
              <div className="nl-fact nl-fact--planned">
                <h3><HardDrive className="size-3.5 text-muted-foreground" aria-hidden="true" />Planned, not shipped</h3>
                <p>Cloud workspaces and team collaboration are not included. Optional relay pairing stays explicit and experimental.</p>
              </div>
            </div>

            <div className="nl-files-privacy">
              <span><ShieldCheck className="size-3.5" aria-hidden="true" />No telemetry</span>
              <span><CloudOff className="size-3.5" aria-hidden="true" />No account</span>
              <span><WifiOff className="size-3.5" aria-hidden="true" />No network dependency</span>
            </div>
          </div>

          <div className="nl-file-stage" data-reveal>
            <div className="nl-files-toast" aria-hidden="true"><SavedToast /></div>
            <div className="nl-vault-window nl-window" aria-hidden="true">
              <div className="nl-window-bar">
                <span className="nl-window-dots"><i /><i /><i /></span>
                <span className="nl-window-title">~/nodus-vault</span>
                <span className="nl-window-state">portable</span>
              </div>
              <div className="nl-vault-body">
                <div><strong>vault/</strong></div>
                <div>├── notes/</div>
                <div>│   ├── research-index.md</div>
                <div>│   ├── product-brief.md</div>
                <div>│   └── reading-list.md</div>
                <div>├── databases/</div>
                <div className="is-moss">│   └── reading-list.json</div>
                <div>└── database-views/</div>
                <div className="nl-vault-rule" />
                <div>---</div>
                <div><span className="is-moss">title</span>: Research index</div>
                <div><span className="is-moss">id</span>: 7c9e4a2d-…</div>
                <div>---</div>
                <div>A map of <span className="is-moss">[[local-first]]</span> tools.</div>
              </div>
            </div>

            <div className="nl-file-card nl-file-card--note" aria-hidden="true">
              <FileText className="size-4" />
              <span><strong>research-index.md</strong><span>note · 2.4 kB</span></span>
            </div>
            <div className="nl-file-card nl-file-card--database" aria-hidden="true">
              <FileJson className="size-4" />
              <span><strong>reading-list.json</strong><span>database · portable</span></span>
            </div>
            <div className="nl-file-card nl-file-card--backup" aria-hidden="true">
              <Archive className="size-4" />
              <span><strong>nodus-backup.json</strong><span>verified · 2026-11-16</span></span>
            </div>
            <div className="nl-files-cursor" aria-hidden="true"><CursorChip label="owned by you" moss /></div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------
   Footer / closing
   ------------------------------------------------------------------------- */

const footerLetters = ['N', 'o', 'd', 'u', 's'];

function FooterSunrise() {
  const sunriseRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = sunriseRef.current;
    if (element === null) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window)) return;

    element.classList.add('is-armed');
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) return;
      element.classList.add('is-awake');
      observer.disconnect();
    }, { threshold: 0.08 });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={sunriseRef} className="nl-footer-sunrise">
      <div className="nl-footer-glow" aria-hidden="true" />
      <a href="/" aria-label="Nodus home" className="nl-footer-word focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-success">
        {footerLetters.map((letter, index) => (
          <span key={`${letter}-${index}`} style={{ '--i': index } as CSSProperties} aria-hidden="true">
            {letter}
          </span>
        ))}
      </a>
    </div>
  );
}

function LandingFooter() {
  return (
    <footer className="nl-footer">
      <div className="nl-footer-inner">
        <div className="nl-footer-top">
          <div>
            <p className="nl-footer-kicker">Local-first. Open source. Yours.</p>
            <h2 className="nl-footer-title">Make space for what’s next.</h2>
            <p className="nl-footer-copy">
              A note, a project, a new way to organize your thinking. Start in Nodus and keep your files close.
            </p>
            <div className="nl-footer-actions">
              <Button asChild className="nl-footer-action h-12 focus-visible:ring-background focus-visible:ring-offset-2 focus-visible:ring-offset-[#1b1a18]">
                <a href={WORKSPACE_PATH}>
                  Open your workspace
                  <ArrowRight data-icon="inline-end" aria-hidden="true" />
                </a>
              </Button>
              <Button asChild variant="outline" className="nl-footer-ghost h-12 focus-visible:ring-background focus-visible:ring-offset-2 focus-visible:ring-offset-[#1b1a18]">
                <a href={GITHUB_URL} target="_blank" rel="noreferrer">
                  <GithubMark data-icon="inline-start" />
                  Explore the repository
                  <ArrowUpRight data-icon="inline-end" aria-hidden="true" />
                </a>
              </Button>
            </div>
          </div>

          <nav aria-label="Footer" className="nl-footer-nav">
            <div>
              <h3>Explore Nodus</h3>
              <a href="#features">Connected notes</a>
              <a href="#databases">Flexible databases</a>
              <a href="#philosophy">Your local files</a>
              <a href={WORKSPACE_PATH}>Workspace</a>
            </div>
            <div>
              <h3>Built in the open</h3>
              <a href={GITHUB_URL} target="_blank" rel="noreferrer">GitHub <ArrowUpRight className="size-3" aria-hidden="true" /></a>
              <p>Apache-2.0 licensed. Read the source, run it locally, and make it yours.</p>
            </div>
          </nav>
        </div>

        <div className="nl-footer-bottom">
          <span>A local-first workspace for connected thinking.</span>
          <span><LockKeyhole className="size-3" aria-hidden="true" />Plain Markdown. No account required.</span>
        </div>
      </div>
      <FooterSunrise />
    </footer>
  );
}

/* -------------------------------------------------------------------------
   Page
   ------------------------------------------------------------------------- */

export default function LandingPage() {
  const [entranceReady, setEntranceReady] = useState(false);
  const heroRef = useRef<HTMLElement>(null);
  useRevealOnScroll();

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setEntranceReady(true);
      return;
    }

    const splash = document.querySelector('.nodus-logo-splash');
    if (splash === null) {
      setEntranceReady(true);
      return;
    }

    const observer = new MutationObserver(() => {
      if (document.querySelector('.nodus-logo-splash') !== null) return;
      observer.disconnect();
      setEntranceReady(true);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return (
    <div className={cn('landing-page nl-page min-h-dvh bg-background text-foreground', entranceReady && 'landing-started')}>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[60] focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground focus:shadow-md focus:outline-none focus:ring-2 focus:ring-ring/80"
      >
        Skip to content
      </a>
      <LandingNav />
      <main id="main-content" tabIndex={-1} className="outline-none">
        <Hero sectionRef={heroRef} />
        <div className="nl-statement-wrap"><LandingStatement /></div>
        <Capabilities />
        <ProcessShowcase />
        <ModuleRail />
        <ValueMarquee />
        <FilesSection />
      </main>
      <LandingFooter />
    </div>
  );
}
