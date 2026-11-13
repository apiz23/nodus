import { useEffect, useRef, useState, type ReactNode, type SVGProps } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  Check,
  CheckCircle2,
  Columns3,
  Database,
  FileText,
  GitBranch,
  Folder,
  HardDrive,
  Link2,
  Menu,
  Moon,
  Sun,
  ListChecks,
  Network,
  Search,
  ShieldCheck,
  Sigma,
  Table2,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { LandingStatement } from './LandingStatement';
import { NodusMark } from './NodusMark';
import { readWorkspaceTheme, saveGlobalTheme, type WorkspaceTheme } from './workspacePreferences';

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
    <a
      href="/"
      className="group inline-flex items-center gap-2.5 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      aria-label="Nodus home"
    >
      <NodusMark className="size-7 text-foreground transition-transform duration-200 group-hover:-rotate-3" />
      <span className="text-[17px] font-semibold tracking-[-0.03em]">Nodus</span>
    </a>
  );
}

function NavLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      className="rounded-sm text-[13px] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-background"
    >
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
    <header className="relative z-40 border-b border-border bg-background">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-5">
        <Wordmark />
        <nav aria-label="Primary" className="hidden items-center gap-7 md:flex">
          {navLinks.map((link) => (
            <NavLink key={link.href} href={link.href}>{link.label}</NavLink>
          ))}
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-sm text-[13px] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-background"
          >
            GitHub <ArrowUpRight className="size-3" aria-hidden="true" />
          </a>
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <Button type="button" variant="ghost" size="icon" className="size-11" aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} onClick={toggleTheme}>{theme === 'dark' ? <Sun /> : <Moon />}</Button>
          <Button asChild size="sm" className="hidden h-11 sm:inline-flex">
            <a href={WORKSPACE_PATH}>
              Open workspace
              <ArrowRight data-icon="inline-end" aria-hidden="true" />
            </a>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-11 md:hidden"
                aria-label="Open menu"
              >
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

function ProductPreview() {
  return (
    <figure className="landing-rise landing-delay-3 mx-auto mt-12 w-full max-w-6xl overflow-hidden rounded-lg border border-border bg-card shadow-[0_24px_80px_-40px_var(--foreground)]" aria-label="An example workspace in the current Nodus application">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-2"><NodusMark className="size-4 text-success" />Inside Nodus</span>
        <span>Example local workspace</span>
      </div>
      <div className="relative overflow-hidden bg-background">
        <img src="/brand/nodus-editor-light.jpg" alt="Nodus showing a Markdown project note, wiki links, tasks, a note sidebar, and the Connections action." width={1440} height={900} fetchPriority="high" className="block h-auto w-full dark:hidden" />
        <img src="/brand/nodus-editor-dark.jpg" alt="Nodus project note in the dark theme, with Markdown tasks and linked research." width={1440} height={900} className="hidden h-auto w-full dark:block" />
      </div>
    </figure>
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden" data-enter>
      <div className="mx-auto grid max-w-6xl gap-10 px-5 pt-12 pb-14 sm:pt-16 lg:min-h-[calc(100svh-4rem)] lg:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)] lg:items-center lg:gap-12 lg:py-12">
        <div className="mx-auto w-full max-w-2xl text-center lg:mx-0 lg:max-w-none lg:text-left">
          <p className="landing-rise mb-5 flex items-center justify-center gap-2 text-[13px] font-medium tracking-wide text-muted-foreground lg:justify-start"><span className="size-1.5 rounded-full bg-success" />Local-first. No account required.</p>
          <h1 className="landing-rise font-heading text-[clamp(2.5rem,5vw,4.25rem)] leading-[1.08] font-bold tracking-[-0.04em] text-balance">Your local workspace<br /><span className="text-muted-foreground">for notes and projects.</span></h1>
          <p className="landing-rise landing-delay-2 mx-auto mt-6 max-w-[56ch] text-base leading-7 text-muted-foreground sm:text-lg sm:leading-8 lg:mx-0">Write in Markdown, connect your research, and shape flexible databases around the work. Your notes stay in files you control.</p>
          <div className="landing-rise landing-delay-3 mt-7 flex flex-wrap items-center justify-center gap-3 lg:justify-start">
            <Button asChild className="h-11 px-5"><a href={WORKSPACE_PATH}>Start writing<ArrowRight data-icon="inline-end" aria-hidden="true" /></a></Button>
            <Button asChild variant="outline" className="h-11 px-5"><a href="#features">Explore the features<ArrowRight data-icon="inline-end" aria-hidden="true" /></a></Button>
          </div>
          <p className="landing-rise landing-delay-3 mt-4 text-[13px] text-muted-foreground">Your notes are Markdown files. Your workspace stays yours.</p>
        </div>
        <div className="min-w-0"><ProductPreview /></div>
      </div>
    </section>
  );
}

function PrincipleStrip() {
  const items = [
    { icon: FileText, label: 'Plain files, always' },
    { icon: HardDrive, label: 'Local by default' },
    { icon: ShieldCheck, label: 'No account required' },
    { icon: GithubMark, label: 'Apache-2.0' },
  ];

  return (
    <div className="border-y border-border bg-background">
      <div className="mx-auto max-w-6xl px-5">
        <div className="grid grid-cols-2 gap-px bg-border sm:grid-cols-4">
          {items.map((item) => (
            <div key={item.label} className="flex items-center gap-2 bg-background px-3 py-4 text-[12.5px] text-muted-foreground sm:px-4">
              <item.icon className="size-3.5 shrink-0 text-success" aria-hidden="true" />
              <span>{item.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SectionHeader({ title, copy }: { title: string; copy: string }) {
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:items-start lg:gap-16">
      <h2 className="max-w-[20ch] font-heading text-[clamp(2.15rem,4.6vw,3.5rem)] leading-[1.08] font-bold tracking-[-0.022em] text-balance">
        {title}
      </h2>
      <p className="max-w-[56ch] text-[17px] leading-7 text-muted-foreground">
        {copy}
      </p>
    </div>
  );
}

type GraphNodeKind = 'hub' | 'note' | 'database';

interface DemoGraphNode {
  id: string;
  label: string;
  detail: string;
  left: number;
  top: number;
  kind: GraphNodeKind;
}

const demoGraphNodes: DemoGraphNode[] = [
  { id: 'research', label: 'Research index', detail: '4 backlinks', left: 50, top: 49, kind: 'hub' },
  { id: 'brief', label: 'Product brief', detail: '2 links in', left: 21, top: 24, kind: 'note' },
  { id: 'reading', label: 'Reading list', detail: 'database', left: 79, top: 20, kind: 'database' },
  { id: 'local', label: 'Local-first notes', detail: '3 links in', left: 21, top: 79, kind: 'note' },
  { id: 'weekly', label: 'Weekly review', detail: '1 link in', left: 79, top: 80, kind: 'note' },
];

const demoGraphEdges: Array<[string, string]> = [
  ['research', 'brief'],
  ['research', 'reading'],
  ['research', 'local'],
  ['research', 'weekly'],
  ['brief', 'local'],
  ['reading', 'weekly'],
];

function graphEdgePath(from: DemoGraphNode, to: DemoGraphNode): string {
  const midX = (from.left + to.left) / 2;
  const midY = (from.top + to.top) / 2 - 6;
  return `M ${from.left} ${from.top} Q ${midX} ${midY} ${to.left} ${to.top}`;
}

function KnowledgeMap() {
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (map === null || !('IntersectionObserver' in window)) return;

    map.classList.add('landing-living-map--armed');
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) return;
      map.classList.add('landing-living-map--revealed');
      observer.disconnect();
    }, { threshold: 0.18, rootMargin: '0px 0px -8% 0px' });

    observer.observe(map);
    return () => observer.disconnect();
  }, []);

  const byId = new Map(demoGraphNodes.map((node) => [node.id, node]));
  const focused = focusedId === null ? null : byId.get(focusedId) ?? null;
  const connectionCount = focusedId === null
    ? 0
    : demoGraphEdges.filter(([from, to]) => from === focusedId || to === focusedId).length;

  return (
    <div ref={mapRef} className="landing-living-map relative h-[380px] overflow-hidden bg-card sm:h-[430px]">
      <div className="landing-map-grid absolute inset-0 opacity-70" aria-hidden="true" />
      <div className="absolute top-4 left-4 z-10 flex items-center gap-2 font-mono text-[9px] tracking-[0.12em] text-muted-foreground">
        <span className="size-1.5 rounded-full bg-success" />
        LOCAL GRAPH
        <span className="text-border">/</span>
        12 NOTES · 28 LINKS
      </div>

      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 size-full" aria-hidden="true">
        {demoGraphEdges.map(([fromId, toId]) => {
          const from = byId.get(fromId);
          const to = byId.get(toId);
          if (from === undefined || to === undefined) return null;
          const connected = focusedId === null || focusedId === fromId || focusedId === toId;
          const d = graphEdgePath(from, to);
          return (
            <g key={`${fromId}:${toId}`} className="transition-opacity duration-300">
              <path
                d={d}
                fill="none"
                vectorEffect="non-scaling-stroke"
                className={cn(
                  'landing-map-edge transition-colors duration-300',
                  connected ? 'stroke-success/55' : 'stroke-border',
                  focusedId === null ? 'opacity-70' : connected ? 'opacity-100' : 'opacity-35',
                )}
                strokeWidth={connected && focusedId !== null ? 1.4 : 1}
              />
              {focusedId !== null && connected ? (
                <path d={d} fill="none" vectorEffect="non-scaling-stroke" className="graph-link-flow stroke-success/70" strokeWidth="1.25" />
              ) : null}
            </g>
          );
        })}
      </svg>

      {demoGraphNodes.map((node) => {
        const active = focusedId === null || focusedId === node.id || demoGraphEdges.some(([from, to]) =>
          (from === focusedId && to === node.id) || (to === focusedId && from === node.id),
        );
        const isHub = node.kind === 'hub';
        return (
          <button
            key={node.id}
            type="button"
            aria-pressed={focusedId === node.id}
            aria-label={`${node.label}: ${node.detail}`}
            onMouseEnter={() => setFocusedId(node.id)}
            onMouseLeave={() => setFocusedId(null)}
            onFocus={() => setFocusedId(node.id)}
            onBlur={() => setFocusedId(null)}
            onClick={() => setFocusedId((current) => current === node.id ? null : node.id)}
            style={{ left: `${node.left}%`, top: `${node.top}%` }}
            className={cn(
              'absolute z-10 -translate-x-1/2 -translate-y-1/2 rounded-md border text-left transition-all duration-300',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card',
              isHub ? 'w-[142px] border-success/40 bg-background px-3 py-2' : 'w-[120px] bg-background px-2.5 py-1.5 sm:w-auto sm:max-w-[128px]',
              isHub ? 'shadow-[0_10px_30px_-24px_rgba(47,125,99,0.55)]' : 'border-border',
              focusedId !== null && focusedId !== node.id && !active ? 'scale-[0.98] opacity-35' : 'opacity-100',
              focusedId !== null && active ? 'border-success/60' : '',
              focusedId === node.id ? 'scale-[1.03]' : '',
            )}
          >
            <div className={cn('flex items-center gap-1.5', isHub ? 'text-[12px]' : 'text-[9.5px] sm:text-[10px]')}>
              {node.kind === 'database'
                ? <Database className="size-3 text-success" aria-hidden="true" />
                : <FileText className={cn('size-3', isHub && 'text-success')} aria-hidden="true" />}
              <span className={cn('truncate', isHub ? 'font-semibold' : 'font-medium')}>{node.label}</span>
            </div>
            <div className={cn('mt-1 truncate font-mono text-muted-foreground', isHub ? 'text-[9px]' : 'text-[8px]')}>
              {node.detail}
            </div>
            {isHub ? (
              <span className={cn(
                'absolute -top-1.5 -right-1.5 size-3 rounded-full border-2 border-card bg-success transition-transform duration-300',
                focusedId === node.id && 'scale-125',
              )}>
                <span className="graph-node-pulse absolute inset-0 rounded-full bg-success" />
              </span>
            ) : null}
          </button>
        );
      })}

      <div className="absolute inset-x-4 bottom-3 z-10 flex items-end justify-between gap-3">
        <span className="max-w-[24ch] text-[9px] leading-4 text-muted-foreground sm:max-w-none sm:text-[10px]" aria-live="polite">
          {focused === null ? 'Focus a note to trace its links.' : `${focused.label} · ${connectionCount} direct links · ${focused.detail}`}
        </span>
        <span className="hidden items-center gap-3 font-mono text-[8px] text-muted-foreground sm:flex">
          <span className="inline-flex items-center gap-1"><span className="size-1.5 rounded-full bg-success" /> note</span>
          <span className="inline-flex items-center gap-1"><span className="size-1.5 rounded-full bg-border" /> link</span>
        </span>
      </div>
    </div>
  );
}

function ConnectedKnowledge() {
  const features = [
    {
      icon: Link2,
      title: 'Wiki links and backlinks',
      copy: 'Connect notes with [[wiki links]]. Open Connections for backlinks, outgoing links, database references, and related notes.',
    },
    {
      icon: Search,
      title: 'Search notes and their contents',
      copy: 'Search note titles, aliases, paths, and body content. Find the passage and open the note where it belongs.',
    },
    {
      icon: Network,
      title: 'A local graph of your knowledge',
      copy: 'See connected notes, unresolved links, and neighborhoods without sending your vault anywhere.',
    },
  ];

  return (
    <section id="features" className="scroll-mt-20">
      <div className="mx-auto max-w-6xl px-5 py-16 sm:py-24">
        <SectionHeader
          title="Connected notes and their links."
          copy="Nodus keeps Markdown as the source of truth and builds the connections around it. Link freely, then follow the trail through backlinks, search, and the local graph."
        />
        <div className=" mt-10 grid overflow-hidden rounded-lg border border-border lg:grid-cols-[1.15fr_1fr]">
          <figure className="min-w-0 overflow-hidden bg-card" aria-label="The Connections sheet in an example Nodus workspace">
            <img src="/brand/nodus-connections-light.jpg" alt="The actual Nodus Connections sheet, showing backlinks and related notes beside a Markdown document." width={1440} height={900} loading="lazy" className="block h-auto w-full dark:hidden" />
            <img src="/brand/nodus-connections-dark.jpg" alt="The Nodus Connections sheet in dark mode." width={1440} height={900} loading="lazy" className="hidden h-auto w-full dark:block" />
          </figure>
          <div className="divide-y divide-border border-t border-border bg-background lg:border-t-0 lg:border-l">
            {features.map((feature) => (
              <div key={feature.title} className="flex gap-3 px-5 py-6 sm:px-7">
                <feature.icon className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
                <div>
                  <h3 className="text-[15px] font-semibold tracking-tight">{feature.title}</h3>
                  <p className="mt-1.5 max-w-[42ch] text-[15px] leading-6 text-muted-foreground">{feature.copy}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function DatabaseShowcase() {
  return <figure className="overflow-hidden rounded-lg border border-border bg-card" aria-label="A real example database in Nodus">
    <img src="/brand/nodus-database-light.jpg" alt="Nodus Launch notebook database with four note-backed records and a custom Status property." width={1440} height={900} loading="lazy" className="block h-auto w-full dark:hidden" />
    <img src="/brand/nodus-database-dark.jpg" alt="The Nodus Launch notebook database in dark mode." width={1440} height={900} loading="lazy" className="hidden h-auto w-full dark:block" />
  </figure>;
}

function StructuredThinking() {
  const features = [
    { icon: Table2, title: 'Five views for one database', copy: 'Explore Table, List, Gallery, Kanban, and Calendar views with saved filters and visible properties.' },
    { icon: ListChecks, title: 'Typed properties', copy: 'Build around text, dates, numbers, selections, checkboxes, and formulas.' },
    { icon: GitBranch, title: 'Relations', copy: 'Connect records across databases with single or multiple references.' },
    { icon: Sigma, title: 'Rollups', copy: 'Count, sum, conditional count, and completion figures derived from relations.' },
  ];

  return (
    <section id="databases" className="scroll-mt-20 border-t border-border bg-secondary/25">
      <div className="mx-auto max-w-6xl px-5 py-16 sm:py-24">
        <SectionHeader
          title="Build flexible databases around your work."
          copy="Turn Markdown notes into a database without locking them inside one. Add typed properties, save the views that fit the work, and connect records across your vault."
        />
        <div className=" mt-10">
          <DatabaseShowcase />
          <p className="mt-3 text-[13px] leading-5 text-muted-foreground">
            An example project notebook in the current application. Every row opens a Markdown note.
          </p>
        </div>
        <div className="mt-10 grid gap-x-10 sm:grid-cols-2 lg:grid-cols-4">
          {features.map((feature) => (
            <div key={feature.title} className="border-t border-border py-4">
              <div className="flex items-center gap-2">
                <feature.icon className="size-3.5 text-success" aria-hidden="true" />
                <h3 className="text-[14px] font-semibold">{feature.title}</h3>
              </div>
              <p className="mt-1.5 text-[14.5px] leading-6 text-muted-foreground">{feature.copy}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function VaultTree() {
  return (
    <div className="overflow-hidden rounded-lg bg-[#232220] text-[#e8e5df] shadow-[0_20px_60px_-40px_rgba(43,42,38,0.55)]">
      <div className="flex items-center gap-2 border-b border-white/10 px-4 py-2.5">
        <span className="size-2 rounded-full bg-[#f0736c]/70" />
        <span className="size-2 rounded-full bg-[#d6b26a]/70" />
        <span className="size-2 rounded-full bg-[#7fbfa6]/70" />
        <span className="ml-2 font-mono text-[9.5px] text-white/65">~/nodus-vault</span>
        <span className="ml-auto font-mono text-[9px] text-[#7fbfa6]">portable</span>
      </div>
      <div className="p-4 font-mono text-[10.5px] leading-6 sm:p-5 sm:text-[11px]">
        <div className="text-white/65">vault/</div>
        <div className="text-white/80">├── notes/</div>
        <div className="pl-7 text-white/65">│   ├── research-index.md</div>
        <div className="pl-7 text-white/65">│   ├── product-brief.md</div>
        <div className="pl-7 text-white/65">│   └── reading-list.md</div>
        <div className="text-white/80">├── databases/</div>
        <div className="pl-7 text-white/65">│   └── reading-list.json</div>
        <div className="text-white/80">└── database-views/</div>
        <div className="pl-7 text-white/65">    └── reading-list/</div>
        <Separator className="my-3.5 bg-white/10" />
        <div className="text-white/65">---</div>
        <div><span className="text-[#7fbfa6]">title</span>: Research index</div>
        <div><span className="text-[#7fbfa6]">id</span>: 7c9e4a2d-…</div>
        <div className="text-white/65">---</div>
        <div className="mt-2 text-white/75">A map of <span className="text-[#7fbfa6]">[[local-first]]</span> tools.</div>
      </div>
    </div>
  );
}

function Ownership() {
  return (
    <section id="philosophy" className="scroll-mt-20 border-t border-border">
      <div className="mx-auto max-w-6xl px-5 py-16 sm:py-24">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)] lg:items-start lg:gap-20">
          <div>
            <h2 className="max-w-[18ch] font-heading text-[clamp(2.15rem,4.6vw,3.5rem)] leading-[1.08] font-bold tracking-[-0.022em] text-balance">
              Nothing between you and your files.
            </h2>
            <p className="mt-4 max-w-[56ch] text-[17px] leading-7 text-muted-foreground">
              Your vault is a folder of ordinary Markdown, portable database definitions, and saved views. Read it in any editor, move it with your filesystem, and back it up on your terms.
            </p>
            <div className="mt-7 grid gap-5 border-t border-border pt-5 sm:grid-cols-2 sm:gap-8">
              <div>
                <div className="flex items-center gap-2 text-[12.5px] font-semibold">
                  <CheckCircle2 className="size-3.5 text-success" aria-hidden="true" />
                  Available today
                </div>
                <p className="mt-2 text-[14.5px] leading-6 text-muted-foreground">
                  Local vaults, Markdown editing, verified backups, and portable database views.
                </p>
              </div>
              <div className="border-t border-border pt-4 sm:border-t-0 sm:border-l sm:pt-0 sm:pl-8">
                <div className="flex items-center gap-2 text-[12.5px] font-semibold">
                  <HardDrive className="size-3.5 text-muted-foreground" aria-hidden="true" />
                  Planned, not shipped
                </div>
                <p className="mt-2 text-[14.5px] leading-6 text-muted-foreground">
                  Cloud workspaces and team collaboration are not included. Optional relay pairing remains experimental and explicit.
                </p>
              </div>
            </div>
            <div className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-[12.5px] text-muted-foreground">
              <span className="inline-flex items-center gap-1.5"><ShieldCheck className="size-3.5 text-success" aria-hidden="true" /> No telemetry</span>
              <span className="inline-flex items-center gap-1.5"><ShieldCheck className="size-3.5 text-success" aria-hidden="true" /> No account</span>
              <span className="inline-flex items-center gap-1.5"><ShieldCheck className="size-3.5 text-success" aria-hidden="true" /> No network dependency</span>
            </div>
          </div>
          <div>
            <VaultTree />
            <p className="mt-3 text-[12px] leading-5 text-muted-foreground">
              Example vault layout. Note bodies and frontmatter stay readable outside Nodus.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function Workflow() {
  const steps = [
    {
      number: '01',
      icon: FileText,
      title: 'Capture a note',
      copy: 'Write in plain Markdown. Nodus keeps stable IDs and preserves your frontmatter.',
      sample: 'meeting-notes.md',
    },
    {
      number: '02',
      icon: Link2,
      title: 'Connect the context',
      copy: 'Link related notes and follow backlinks. Search and the local graph keep the trail visible.',
      sample: '[[product-brief]]',
    },
    {
      number: '03',
      icon: Database,
      title: 'Structure what matters',
      copy: 'Add the note to a database, type its properties, and shape the view around the work.',
      sample: 'Status · Owner · Priority',
    },
  ];

  return (
    <section className="border-t border-border bg-card/35">
      <div className="mx-auto max-w-6xl px-5 py-16 sm:py-24">
        <SectionHeader
          title="From a thought to a system."
          copy="Start loose. Add structure only where it helps. The note remains Markdown at every step."
        />
        <div className="relative mt-12">
          <div className="workflow-connector absolute top-4 right-[16%] left-[16%] hidden border-t border-dashed border-border md:block" aria-hidden="true" />
          <ol className="relative grid gap-8 md:grid-cols-3 md:gap-0">
            {steps.map((step) => (
              <li key={step.number} className=" relative md:px-6 md:first:pl-0 md:last:pr-0">
                <div className="flex items-center gap-3">
                  <span className="grid size-9 place-items-center rounded-full border border-border bg-background text-[10px] font-semibold tracking-[0.08em]">
                    {step.number}
                  </span>
                  <span className="h-px flex-1 bg-border md:hidden" aria-hidden="true" />
                </div>
                <div className="mt-5 flex items-center gap-2">
                  <step.icon className="size-4 text-success" aria-hidden="true" />
                  <h3 className="text-[15px] font-semibold tracking-tight">{step.title}</h3>
                </div>
                <p className="mt-2 max-w-[34ch] text-[15px] leading-6 text-muted-foreground">{step.copy}</p>
                <div className="mt-4 inline-flex rounded-md border border-border bg-background px-2.5 py-1.5 font-mono text-[11px] text-muted-foreground">
                  {step.sample}
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

interface CtaGraphNode {
  id: string;
  label: string;
  x: number;
  y: number;
  radius: number;
  accent?: boolean;
  dashed?: boolean;
}

const ctaGraphNodes: CtaGraphNode[] = [
  { id: 'notes', label: 'NOTES', x: 104, y: 84, radius: 7 },
  { id: 'links', label: 'WIKI LINKS', x: 454, y: 66, radius: 5, dashed: true },
  { id: 'graph', label: 'LOCAL GRAPH', x: 488, y: 186, radius: 8 },
  { id: 'databases', label: 'DATABASES', x: 414, y: 298, radius: 6 },
  { id: 'vault', label: 'YOUR VAULT', x: 92, y: 286, radius: 9, accent: true },
];

const ctaGraphEdges: Array<[string, string, boolean?]> = [
  ['vault', 'notes', true],
  ['notes', 'links'],
  ['links', 'graph', true],
  ['graph', 'databases'],
  ['databases', 'vault'],
  ['notes', 'graph'],
];

function OpenSourceGraph() {
  const center = { x: 280, y: 178 };
  const byId = new Map(ctaGraphNodes.map((node) => [node.id, node]));
  const pathFor = (from: { x: number; y: number }, to: { x: number; y: number }) => {
    const midX = (from.x + to.x) / 2;
    const midY = (from.y + to.y) / 2 - 24;
    return `M ${from.x} ${from.y} Q ${midX} ${midY} ${to.x} ${to.y}`;
  };

  return (
    <div className="relative mx-auto h-[260px] w-full max-w-[560px] text-background sm:h-[310px] lg:h-[350px]" aria-hidden="true">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,color-mix(in_oklab,var(--success)_14%,transparent),transparent_60%)]" />
      <svg viewBox="0 0 560 360" className="relative size-full" fill="none">
        <g>
          {ctaGraphEdges.map(([fromId, toId, animated]) => {
            const from = byId.get(fromId);
            const to = byId.get(toId);
            if (from === undefined || to === undefined) return null;
            const d = pathFor(from, to);
            return (
              <g key={`${fromId}:${toId}`}>
                <path d={d} stroke="currentColor" strokeOpacity=".18" strokeWidth="1" vectorEffect="non-scaling-stroke" />
                {animated ? (
                  <path d={d} stroke="var(--success)" strokeOpacity=".55" strokeWidth="1.15" vectorEffect="non-scaling-stroke" className="graph-link-flow" />
                ) : null}
              </g>
            );
          })}
          {ctaGraphNodes.map((node) => pathFor(center, node)).map((d, index) => (
            <path key={`center-${index}`} d={d} stroke="currentColor" strokeOpacity=".12" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          ))}
        </g>

        <g>
          <circle cx={center.x} cy={center.y} r="36" stroke="currentColor" strokeOpacity=".12" />
          <circle cx={center.x} cy={center.y} r="22" stroke="var(--success)" strokeOpacity=".32" />
          <circle cx={center.x} cy={center.y} r="17" fill="var(--success)" fillOpacity=".14" className="graph-node-pulse" />
          <circle cx={center.x} cy={center.y} r="7.5" fill="var(--success)" />
        </g>

        {ctaGraphNodes.map((node) => {
          const labelOnLeft = node.x <= center.x || node.x > 440;
          const labelX = labelOnLeft ? node.x - node.radius - 10 : node.x + node.radius + 10;
          const anchor = labelOnLeft ? 'end' : 'start';
          const labelY = node.y + 3;
          return (
            <g key={node.id}>
              <circle cx={node.x} cy={node.y} r={node.radius + 8} stroke={node.accent ? 'var(--success)' : 'currentColor'} strokeOpacity={node.accent ? '.35' : '.12'} strokeDasharray={node.dashed ? '2 4' : undefined} />
              <circle cx={node.x} cy={node.y} r={node.radius} fill={node.accent ? 'var(--success)' : 'currentColor'} fillOpacity={node.accent ? '.85' : '.75'} />
              <circle cx={node.x} cy={node.y} r={Math.max(2, node.radius * 0.3)} fill="var(--foreground)" fillOpacity=".8" />
              <text x={labelX} y={labelY} textAnchor={anchor} fill="currentColor" fillOpacity=".62" fontSize="9" letterSpacing="1" fontFamily="ui-monospace, SFMono-Regular, Consolas, monospace">
                {node.label}
              </text>
            </g>
          );
        })}

        <text x={center.x} y={center.y + 55} textAnchor="middle" fill="currentColor" fillOpacity=".38" fontSize="8.5" letterSpacing="1.1" fontFamily="ui-monospace, SFMono-Regular, Consolas, monospace">
          ONE VAULT · EVERY CONNECTION LOCAL
        </text>
      </svg>
    </div>
  );
}

function OpenSourceCta() {
  return (
    <section className="border-t border-border bg-foreground text-background">
      <div className="relative mx-auto max-w-6xl overflow-hidden px-5 py-16 sm:py-20">
        <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)] lg:gap-14">
          <div className=" relative max-w-[620px]">
            <h2 className="font-heading text-[clamp(2.1rem,4.8vw,3.6rem)] leading-[1.08] font-bold tracking-[-0.02em] text-balance">
              Built in the open. Owned by you.
            </h2>
            <p className="mt-4 max-w-[54ch] text-base leading-7 text-background/65">
              Nodus is Apache-2.0 licensed. Read the code, run it locally, inspect the storage model, and help shape what comes next.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Button asChild className="h-11 bg-background px-4 text-sm text-foreground hover:bg-background/90 sm:h-10">
                <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="group">
                  <GithubMark data-icon="inline-start" />
                  Explore the repository
                  <ArrowUpRight data-icon="inline-end" aria-hidden="true" className="transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                </a>
              </Button>
              <Button asChild variant="outline" className="h-11 border-background/20 bg-transparent px-4 text-sm text-background hover:bg-background/10 hover:text-background sm:h-10">
                <a href={WORKSPACE_PATH} className="group">
                  Open the workspace
                  <ArrowRight data-icon="inline-end" aria-hidden="true" className="transition-transform duration-200 group-hover:translate-x-0.5" />
                </a>
              </Button>
            </div>
          </div>
          <div>
            <OpenSourceGraph />
          </div>
        </div>
      </div>
    </section>
  );
}

function LandingFooter() {
  const footerLink = 'inline-flex min-h-11 items-center rounded-sm text-sm text-background/80 transition-colors hover:text-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-background';
  return (
    <footer className="border-t border-border bg-foreground text-background">
      <div className="mx-auto max-w-6xl px-5 pt-14 pb-6 sm:pt-20">
        <div className="grid gap-12 border-b border-background/20 pb-12 md:grid-cols-[1.3fr_1fr] md:gap-20">
          <div>
            <p className="mb-5 text-[13px] font-medium tracking-wide text-background/80">Local-first. Open source. Yours.</p>
            <h2 className="max-w-[16ch] font-heading text-[clamp(2.25rem,4.8vw,4rem)] leading-[1.1] font-semibold tracking-[-0.04em]">Make space for what’s next.</h2>
            <p className="mt-5 max-w-[43ch] text-base leading-7 text-background/80">A note, a project, a new way to organize your thinking. Start in Nodus and keep your files close.</p>
            <Button asChild className="mt-7 h-11 bg-background px-5 text-foreground hover:bg-background/90 focus-visible:ring-background focus-visible:ring-offset-2 focus-visible:ring-offset-foreground"><a href={WORKSPACE_PATH}>Open your workspace<ArrowRight data-icon="inline-end" aria-hidden="true" /></a></Button>
          </div>
          <nav aria-label="Footer" className="grid grid-cols-2 gap-8 md:pt-1">
            <div className="flex flex-col items-start"><h3 className="mb-3 text-[13px] font-semibold text-background/80">Explore Nodus</h3><a className={footerLink} href="#features">Connected notes</a><a className={footerLink} href="#databases">Flexible databases</a><a className={footerLink} href="#philosophy">Your local files</a><a className={footerLink} href={WORKSPACE_PATH}>Workspace</a></div>
            <div className="flex flex-col items-start"><h3 className="mb-3 text-[13px] font-semibold text-background/80">Built in the open</h3><a className={footerLink} href={GITHUB_URL} target="_blank" rel="noreferrer">GitHub<ArrowUpRight className="ml-1 size-3" aria-hidden="true" /></a><p className="mt-3 max-w-[22ch] text-sm leading-6 text-background/80">Apache-2.0 licensed. Read the source, run it locally, and make it yours.</p></div>
          </nav>
        </div>
        <a href="/" aria-label="Nodus home" className="flex min-w-0 items-center gap-5 rounded-sm py-8 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-background sm:gap-8 sm:py-10"><NodusMark className="size-[clamp(2.25rem,10vw,8rem)] shrink-0" /><span className="font-heading text-[clamp(4rem,19vw,15rem)] leading-none font-semibold tracking-[-0.065em]">Nodus</span></a>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-background/20 pt-5 text-[13px] text-background/80"><span>A local-first workspace for connected thinking.</span><span>Plain Markdown. No account required.</span></div>
      </div>
    </footer>
  );
}

export default function LandingPage() {
  const [entranceReady, setEntranceReady] = useState(false);

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
    <div className={cn('landing-page min-h-dvh bg-background text-foreground', entranceReady && 'landing-started')}>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[60] focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground focus:shadow-md focus:outline-none focus:ring-2 focus:ring-ring/80"
      >
        Skip to content
      </a>
      <LandingNav />
      <main id="main-content" tabIndex={-1} className="outline-none">
        <Hero />
        <PrincipleStrip />
        <ConnectedKnowledge />
        <StructuredThinking />
        <Ownership />
        <LandingStatement />
      </main>
      <LandingFooter />
    </div>
  );
}
