import type { ReactNode, SVGProps } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  Check,
  CheckCircle2,
  Columns3,
  Database,
  FileText,
  Folder,
  HardDrive,
  Link2,
  Menu,
  Network,
  Search,
  ShieldCheck,
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

const GITHUB_URL = 'https://github.com/apiz23/nodus';
const WORKSPACE_PATH = '/app';

const navLinks = [
  { href: '#features', label: 'Features' },
  { href: '#philosophy', label: 'Philosophy' },
];

function GithubMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0 0 22 12.017C22 6.484 17.522 2 12 2Z" />
    </svg>
  );
}

function NodusMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M7.5 23.5 16 7.5l8.5 16H7.5Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M11.5 18.2h9" stroke="currentColor" strokeWidth="1.8" opacity=".38" />
      <circle cx="16" cy="7.5" r="2.4" fill="currentColor" />
      <circle cx="7.5" cy="23.5" r="2.4" fill="currentColor" />
      <circle cx="24.5" cy="23.5" r="2.4" fill="currentColor" />
      <circle cx="16" cy="18.2" r="1.8" fill="var(--success)" />
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
  return (
    <header className="sticky top-0 z-40 border-b border-border/80 bg-background/88 backdrop-blur-md">
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
          <Button asChild size="sm" className="hidden h-11 lg:h-10 sm:inline-flex">
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

function PreviewSidebar() {
  const notes = [
    { label: 'Research index', active: true },
    { label: 'Product brief' },
    { label: 'Reading list' },
    { label: 'Local-first notes' },
  ];

  return (
    <aside className="hidden min-w-0 flex-col border-r border-border bg-sidebar p-2.5 sm:flex">
      <div className="mb-3 flex items-center gap-2 px-1">
        <div className="grid size-5 place-items-center rounded-[5px] bg-foreground text-[9px] font-semibold text-background">
          N
        </div>
        <span className="text-[11px] font-semibold tracking-tight">Nodus</span>
        <span className="ml-auto size-1.5 rounded-full bg-success" />
      </div>
      <div className="mb-3 flex items-center gap-1.5 rounded-md border border-input bg-background px-2 py-1.5 text-[10px] text-muted-foreground">
        <Search className="size-3" aria-hidden="true" />
        <span>Search notes</span>
        <kbd className="ml-auto rounded border border-border bg-muted px-1 font-sans text-[9px]">⌘K</kbd>
      </div>
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center gap-2 rounded-sm px-1.5 py-1 text-[10.5px] text-muted-foreground">
          <FileText className="size-3" aria-hidden="true" /> All notes
        </div>
        <div className="flex items-center gap-2 rounded-sm px-1.5 py-1 text-[10.5px] text-muted-foreground">
          <Network className="size-3" aria-hidden="true" /> Local graph
        </div>
        <div className="flex items-center gap-2 rounded-sm px-1.5 py-1 text-[10.5px] text-muted-foreground">
          <Database className="size-3" aria-hidden="true" /> Databases
        </div>
      </div>
      <div className="mt-4 flex items-center gap-1.5 px-1.5 text-[9px] font-medium tracking-[0.14em] text-muted-foreground">
        NOTES
      </div>
      <div className="mt-1.5 flex flex-col gap-0.5">
        <div className="flex items-center gap-1.5 rounded-sm px-1.5 py-1 text-[10.5px] text-muted-foreground">
          <Folder className="size-3" aria-hidden="true" /> Projects
        </div>
        {notes.map((note) => (
          <div
            key={note.label}
            className={cn(
              'flex items-center gap-1.5 rounded-sm py-1 pr-1.5 pl-4 text-[10.5px]',
              note.active
                ? 'bg-success/12 font-medium text-foreground'
                : 'text-muted-foreground',
            )}
          >
            <FileText className={cn('size-3', note.active && 'text-success')} aria-hidden="true" />
            <span className="truncate">{note.label}</span>
          </div>
        ))}
      </div>
      <div className="mt-auto pt-5">
        <div className="flex items-center gap-1.5 border-t border-sidebar-border pt-2.5 font-mono text-[9px] text-muted-foreground">
          <HardDrive className="size-3" aria-hidden="true" />
          ~/nodus-vault
        </div>
      </div>
    </aside>
  );
}

function PreviewGraph() {
  return (
    <div className="hidden border-l border-border bg-background/50 p-2.5 md:block">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[9px] font-medium tracking-[0.12em] text-muted-foreground">GRAPH</span>
        <Network className="size-3 text-muted-foreground" aria-hidden="true" />
      </div>
      <svg viewBox="0 0 112 112" className="w-full text-muted-foreground/50" aria-hidden="true">
        <path d="M56 56 26 27M56 56l31-29M56 56 28 85M56 56l32 27M26 27l62-1M28 85l60-1" stroke="currentColor" strokeWidth="1" strokeDasharray="3 5" opacity=".6" />
        <circle cx="26" cy="27" r="4" fill="currentColor" opacity=".7" />
        <circle cx="87" cy="26" r="3" fill="currentColor" opacity=".7" />
        <circle cx="28" cy="85" r="3" fill="currentColor" opacity=".7" />
        <circle cx="88" cy="84" r="4" fill="currentColor" opacity=".7" />
        <circle cx="56" cy="56" r="7" fill="var(--success)" opacity=".22" />
        <circle cx="56" cy="56" r="3.5" fill="var(--success)" />
      </svg>
      <div className="mt-2 text-center font-mono text-[9px] text-muted-foreground">12 notes · 28 links</div>
      <div className="mt-4 border-t border-border pt-2">
        <div className="text-[9px] font-medium tracking-[0.12em] text-muted-foreground">BACKLINKS</div>
        <div className="mt-1.5 flex flex-col gap-1">
          <span className="truncate text-[10px]">Product brief</span>
          <span className="truncate text-[10px]">Reading list</span>
          <span className="truncate text-[10px]">Local-first notes</span>
        </div>
      </div>
    </div>
  );
}

function PreviewDatabase() {
  const rows = [
    { title: 'Designing Data-Intensive Applications', status: 'Reading', rating: '5', due: 'Nov 04' },
    { title: 'The Local-First Software paper', status: 'Done', rating: '5', due: 'Oct 22' },
    { title: 'A Philosophy of Software Design', status: 'Queued', rating: '4', due: 'Nov 12' },
  ];

  return (
    <div className="border-t border-border bg-background p-3 sm:p-4">
      <div className="mb-2.5 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5 text-[10.5px] font-medium">
          <Database className="size-3 text-muted-foreground" aria-hidden="true" />
          Reading list
        </div>
        <div className="ml-auto flex items-center gap-0.5 rounded-md bg-muted p-0.5 text-[9px]">
          <span className="inline-flex items-center gap-1 rounded bg-background px-1.5 py-0.5 font-medium shadow-xs">
            <Table2 className="size-2.5" aria-hidden="true" /> Table
          </span>
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-muted-foreground">
            <Columns3 className="size-2.5" aria-hidden="true" /> Kanban
          </span>
          <span className="hidden items-center gap-1 px-1.5 py-0.5 text-muted-foreground sm:inline-flex">
            <CalendarDays className="size-2.5" aria-hidden="true" /> Calendar
          </span>
        </div>
      </div>
      <div className="overflow-hidden rounded-md border border-border">
        <div className="grid grid-cols-[minmax(0,1fr)_62px_36px] gap-2 border-b border-border bg-muted/45 px-2.5 py-1.5 text-[8.5px] font-medium tracking-[0.08em] text-muted-foreground sm:grid-cols-[minmax(0,1fr)_62px_36px_44px]">
          <span>NAME</span>
          <span>STATUS</span>
          <span>RATING</span>
          <span className="hidden sm:block">DUE</span>
        </div>
        {rows.map((row) => (
          <div
            key={row.title}
            className="grid grid-cols-[minmax(0,1fr)_62px_36px] items-center gap-2 border-b border-border/70 px-2.5 py-1.5 text-[9.5px] last:border-b-0 sm:grid-cols-[minmax(0,1fr)_62px_36px_44px]"
          >
            <span className="flex min-w-0 items-center gap-1.5">
              <FileText className="size-2.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="truncate">{row.title}</span>
            </span>
            <span>
              <span
                className={cn(
                  'inline-flex rounded px-1 py-0.5 text-[8.5px] font-medium',
                  row.status === 'Done' && 'bg-success/12 text-success',
                  row.status !== 'Done' && 'bg-secondary text-secondary-foreground',
                )}
              >
                {row.status}
              </span>
            </span>
            <span className="font-mono text-[9px] text-muted-foreground">{row.rating}/5</span>
            <span className="hidden font-mono text-[9px] text-muted-foreground sm:block">{row.due}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ProductPreview() {
  return (
    <figure className="relative mx-auto w-full max-w-[680px] lg:mx-0">
      <div className="landing-rise landing-delay-2 relative">
        <div className="absolute -inset-5 -z-10 rounded-[2rem] bg-success/[0.035] blur-2xl" aria-hidden="true" />
        <div
          role="img"
          aria-label="Illustrative preview of the Nodus workspace: a sidebar of Markdown notes, a note called Research index with wiki links and backlinks, a local graph, and a Reading list database in table view."
          className="overflow-hidden rounded-xl bg-card shadow-[0_30px_90px_-45px_rgba(43,42,38,0.45),0_2px_6px_-2px_rgba(43,42,38,0.08)]"
        >
          <div className="flex h-9 items-center gap-2 border-b border-border bg-muted/25 px-3">
            <div className="flex items-center gap-1" aria-hidden="true">
              <span className="size-1.5 rounded-full bg-border" />
              <span className="size-1.5 rounded-full bg-border" />
              <span className="size-1.5 rounded-full bg-border" />
            </div>
            <span className="ml-1 font-mono text-[9px] text-muted-foreground">nodus / research-vault</span>
            <span className="ml-auto inline-flex items-center gap-1.5 text-[9px] text-muted-foreground">
              <span className="size-1.5 rounded-full bg-success" />
              Saved locally
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-[148px_minmax(0,1fr)]">
            <PreviewSidebar />
            <div className="min-w-0">
              <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_128px]">
                <div className="min-w-0 px-4 py-4 sm:px-5">
                  <div className="mb-3 flex items-center gap-1 overflow-hidden font-mono text-[9px] text-muted-foreground">
                    <span>notes</span>
                    <span aria-hidden="true">/</span>
                    <span className="truncate">research-index.md</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="grid size-6 shrink-0 place-items-center rounded-md border border-border bg-muted/60">
                      <FileText className="size-3.5 text-success" aria-hidden="true" />
                    </span>
                    <div className="min-w-0">
                      <div className="truncate text-[15px] font-semibold tracking-[-0.02em]">Research index</div>
                      <div className="mt-0.5 flex items-center gap-1.5 text-[8.5px] text-muted-foreground">
                        <span className="inline-flex rounded bg-secondary px-1 py-0.5">index</span>
                        <span className="inline-flex rounded bg-secondary px-1 py-0.5">local-first</span>
                      </div>
                    </div>
                  </div>
                  <p className="mt-4 text-[11px] leading-5 text-foreground/90">
                    A map of what we know about local-first tools. Start with{' '}
                    <span className="text-success underline decoration-success/35 underline-offset-2">[[Product brief]]</span>{' '}
                    and{' '}
                    <span className="text-success underline decoration-success/35 underline-offset-2">[[Reading list]]</span>.
                  </p>
                  <div className="mt-3.5 border-l-2 border-success/30 pl-2.5">
                    <div className="flex items-center gap-1 text-[9px] font-medium text-success">
                      <Link2 className="size-2.5" aria-hidden="true" /> 4 backlinks
                    </div>
                    <p className="mt-1 text-[9.5px] leading-4 text-muted-foreground">
                      Linked from Product brief, Meeting notes, Weekly review, and Reading list.
                    </p>
                  </div>
                  <div className="mt-3.5 text-[10px] font-semibold">Open questions</div>
                  <div className="mt-1.5 flex flex-col gap-1.5 text-[9.5px] text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                      <span className="grid size-3 place-items-center rounded-[3px] border border-success/50 bg-success/10">
                        <Check className="size-2 text-success" aria-hidden="true" />
                      </span>
                      <span className="line-through decoration-border">Compare sync boundaries</span>
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="size-3 rounded-[3px] border border-input" />
                      Write the portability note
                    </span>
                  </div>
                </div>
                <PreviewGraph />
              </div>
              <PreviewDatabase />
            </div>
          </div>
        </div>
      </div>
      <figcaption className="mt-4 flex items-center gap-2 text-[12px] leading-5 text-muted-foreground">
        <span className="h-px w-6 bg-border" aria-hidden="true" />
        Illustrative workspace preview. Notes, links, graph, and database views reflect the local app.
      </figcaption>
    </figure>
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-5 pt-14 pb-16 sm:pt-20 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:gap-10 lg:items-start lg:pt-24 lg:pb-20">
        <div className="min-w-0">
          <h1 className="landing-rise text-[clamp(2.25rem,8.4vw,3.8rem)] leading-[1] font-semibold tracking-[-0.04em] text-balance">
            <span className="block">Your knowledge.</span>
            <span className="block">Your files.</span>
            <span className="block">Your rules<span className="text-success">.</span></span>
          </h1>
          <p className="landing-rise landing-delay-2 mt-6 max-w-[48ch] text-base leading-7 text-muted-foreground sm:leading-[1.75]">
            A connected knowledge workspace built around Markdown. Link your notes, organize information into powerful databases, and keep control of where your knowledge lives.
          </p>
          <div className="landing-rise landing-delay-3 mt-7 flex flex-wrap items-center gap-3">
            <Button asChild className="h-11 px-4 text-sm sm:h-10">
              <a href={WORKSPACE_PATH}>
                Explore Nodus
                <ArrowRight data-icon="inline-end" aria-hidden="true" />
              </a>
            </Button>
            <Button asChild variant="outline" className="h-11 px-4 text-sm sm:h-10">
              <a href={GITHUB_URL} target="_blank" rel="noreferrer">
                <GithubMark data-icon="inline-start" />
                View on GitHub
              </a>
            </Button>
          </div>
          <div className="landing-rise landing-delay-3 mt-8 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border pt-4 text-[12.5px] text-muted-foreground">
            <span>Markdown in. Markdown out.</span>
            <span className="hidden h-3 w-px bg-border sm:block" aria-hidden="true" />
            <span>
              Every note is a <span className="font-mono text-[11.5px]">.md</span> file you own.
            </span>
          </div>
        </div>
        <ProductPreview />
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
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:items-end lg:gap-16">
      <h2 className="max-w-[20ch] text-[clamp(2rem,4.2vw,3.25rem)] leading-[1.04] font-semibold tracking-[-0.04em] text-balance">
        {title}
      </h2>
      <p className="max-w-[56ch] text-base leading-7 text-muted-foreground">
        {copy}
      </p>
    </div>
  );
}

function KnowledgeMap() {
  return (
    <div className="relative min-h-[340px] overflow-hidden bg-card p-5 sm:min-h-[330px] sm:p-7">
      <svg viewBox="0 0 400 300" className="absolute inset-0 h-full w-full text-border" preserveAspectRatio="none" aria-hidden="true">
        <path d="M200 152 98 86M200 152l107-68M200 152l-92 82M200 152l100 70" stroke="currentColor" strokeWidth="1" />
        <path d="M98 86 305 62M98 86 108 234" stroke="currentColor" strokeWidth="1" strokeDasharray="3 5" opacity=".6" />
        <circle cx="200" cy="152" r="4" fill="var(--success)" />
        <circle cx="98" cy="86" r="3" fill="currentColor" />
        <circle cx="305" cy="62" r="3" fill="currentColor" />
        <circle cx="108" cy="234" r="3" fill="currentColor" />
        <circle cx="300" cy="222" r="3" fill="currentColor" />
      </svg>
      <div className="absolute top-1/2 left-1/2 w-[142px] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-background px-3 py-2">
        <div className="flex items-center gap-2">
          <FileText className="size-3.5 text-success" aria-hidden="true" />
          <span className="text-[12px] font-semibold">Research index</span>
        </div>
        <div className="mt-1 font-mono text-[9px] text-muted-foreground">research-index.md</div>
      </div>
      <div className="absolute top-[9%] left-[2%] w-[112px] rounded-md border border-border bg-background px-2.5 py-1.5 sm:top-[20%] sm:left-[4%] sm:w-auto sm:max-w-[120px]">
        <div className="text-[10px] font-medium">Product brief</div>
        <div className="mt-0.5 font-mono text-[8px] text-muted-foreground">3 links in</div>
      </div>
      <div className="absolute top-[9%] right-[2%] w-[112px] rounded-md border border-border bg-background px-2.5 py-1.5 sm:top-[12%] sm:right-[2%] sm:w-auto sm:max-w-[120px]">
        <div className="text-[10px] font-medium">Reading list</div>
        <div className="mt-0.5 font-mono text-[8px] text-muted-foreground">database</div>
      </div>
      <div className="absolute bottom-[9%] left-[2%] w-[120px] rounded-md border border-border bg-background px-2.5 py-1.5 sm:bottom-[7%] sm:w-auto sm:max-w-[130px]">
        <div className="flex items-center gap-1.5 text-[10px] font-medium">
          <Link2 className="size-3 text-success" aria-hidden="true" /> Backlinks
        </div>
        <div className="mt-1 text-[8.5px] leading-4 text-muted-foreground">Linked from 4 notes</div>
      </div>
      <div className="absolute right-[2%] bottom-[9%] w-[120px] rounded-md border border-border bg-background px-2.5 py-1.5 sm:right-[3%] sm:bottom-[9%] sm:w-auto sm:max-w-[130px]">
        <div className="flex items-center gap-1.5 text-[10px] font-medium">
          <Search className="size-3 text-success" aria-hidden="true" /> Search
        </div>
        <div className="mt-1 font-mono text-[8.5px] text-muted-foreground">title · alias · path · content</div>
      </div>
    </div>
  );
}

function ConnectedKnowledge() {
  const features = [
    {
      icon: Link2,
      title: 'Wiki links and backlinks',
      copy: 'Connect notes with [[wiki links]]. Nodus tracks linked mentions and shows where an idea came from.',
    },
    {
      icon: Search,
      title: 'Search that finds the thought',
      copy: 'Search note titles, aliases, paths, and body content. Results stay deterministic and readable.',
    },
    {
      icon: Network,
      title: 'A local graph of your knowledge',
      copy: 'See connected notes, unresolved links, and neighborhoods without sending your vault anywhere.',
    },
  ];

  return (
    <section id="features" className="scroll-mt-20 border-t border-border">
      <div className="mx-auto max-w-6xl px-5 py-16 sm:py-24">
        <SectionHeader
          title="Notes that remember each other."
          copy="Nodus keeps Markdown as the source of truth and builds the connections around it. Link freely, then follow the trail through backlinks, search, and the local graph."
        />
        <div className="mt-10 grid overflow-hidden rounded-lg border border-border lg:grid-cols-[1.15fr_1fr]">
          <KnowledgeMap />
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
  const rows = [
    { name: 'Designing Data-Intensive Applications', status: 'Reading', owner: 'Knowledge', priority: 'High', progress: '62%' },
    { name: 'Local-first software', status: 'Done', owner: 'Research', priority: 'Medium', progress: '100%' },
    { name: 'A Philosophy of Software Design', status: 'Queued', owner: 'Craft', priority: 'Low', progress: '18%' },
    { name: 'The Humane Interface', status: 'Reading', owner: 'Interface', priority: 'Medium', progress: '44%' },
  ];

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2 text-[12px] font-semibold">
          <Database className="size-3.5 text-success" aria-hidden="true" />
          Reading list
        </div>
        <Badge variant="secondary" className="font-mono text-[9px]">24 rows</Badge>
        <div className="flex w-full items-center gap-0.5 rounded-md bg-muted p-0.5 text-[10px] sm:ml-auto sm:w-auto">
          <span className="inline-flex items-center gap-1 rounded bg-background px-2 py-1 font-medium shadow-xs">
            <Table2 className="size-3" aria-hidden="true" /> Table
          </span>
          <span className="inline-flex items-center gap-1 px-2 py-1 text-muted-foreground">
            <Columns3 className="size-3" aria-hidden="true" /> Kanban
          </span>
          <span className="inline-flex items-center gap-1 px-2 py-1 text-muted-foreground">
            <CalendarDays className="size-3" aria-hidden="true" /> Calendar
          </span>
        </div>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_72px_44px] gap-3 border-b border-border bg-muted/40 px-4 py-2 text-[9px] font-medium tracking-[0.1em] text-muted-foreground sm:grid-cols-[minmax(0,1.7fr)_88px_96px_74px_58px]">
        <span>NAME</span><span>STATUS</span><span className="hidden sm:block">OWNER</span><span className="hidden sm:block">PRIORITY</span><span>PROGRESS</span>
      </div>
      {rows.map((row) => (
        <div key={row.name} className="grid grid-cols-[minmax(0,1fr)_72px_44px] items-center gap-3 border-b border-border/70 px-4 py-2.5 text-[10.5px] last:border-b-0 sm:grid-cols-[minmax(0,1.7fr)_88px_96px_74px_58px]">
          <span className="flex min-w-0 items-center gap-2">
            <FileText className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="truncate">{row.name}</span>
          </span>
          <span>
            <span className={cn(
              'inline-flex rounded px-1.5 py-0.5 text-[9px] font-medium',
              row.status === 'Done' && 'bg-success/12 text-success',
              row.status === 'Reading' && 'bg-secondary text-foreground',
              row.status === 'Queued' && 'bg-muted text-muted-foreground',
            )}>
              {row.status}
            </span>
          </span>
          <span className="hidden truncate text-muted-foreground sm:block">{row.owner}</span>
          <span className="hidden text-muted-foreground sm:block">{row.priority}</span>
          <span className="font-mono text-[9px] text-muted-foreground">{row.progress}</span>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2 border-t border-border bg-muted/20 px-4 py-2.5">
        <Badge variant="outline" className="font-mono text-[9px]">Relation: Topic</Badge>
        <Badge variant="outline" className="font-mono text-[9px]">Rollup: Pages</Badge>
        <Badge variant="outline" className="font-mono text-[9px]">Rollup: Completion</Badge>
        <span className="ml-auto text-[9px] text-muted-foreground">Typed properties · saved views</span>
      </div>
    </div>
  );
}

function StructuredThinking() {
  const features = [
    { title: 'Table, Kanban, Calendar', copy: 'Save named views with typed sorting, filters, and property visibility.' },
    { title: 'Typed properties', copy: 'Text, numbers, checkboxes, dates, select, and multi-select fields.' },
    { title: 'Relations', copy: 'Connect records across databases with single or multiple references.' },
    { title: 'Rollups', copy: 'Count, sum, conditional count, and completion figures derived from relations.' },
  ];

  return (
    <section className="border-t border-border bg-secondary/25">
      <div className="mx-auto max-w-6xl px-5 py-16 sm:py-24">
        <SectionHeader
          title="Free-form notes. Structured when you need it."
          copy="Turn Markdown notes into a database without locking them inside one. Add typed properties, save the views that fit the work, and connect records across your vault."
        />
        <div className="mt-10">
          <DatabaseShowcase />
          <p className="mt-3 text-[12px] leading-5 text-muted-foreground">
            Illustrative database view. Table, Kanban, and Calendar are saved views over Markdown notes.
          </p>
        </div>
        <div className="mt-10 grid gap-x-10 sm:grid-cols-2 lg:grid-cols-4">
          {features.map((feature) => (
            <div key={feature.title} className="border-t border-border py-4">
              <h3 className="text-[14px] font-semibold">{feature.title}</h3>
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
        <span className="ml-2 font-mono text-[9.5px] text-white/45">~/nodus-vault</span>
        <span className="ml-auto font-mono text-[9px] text-[#7fbfa6]">portable</span>
      </div>
      <div className="p-4 font-mono text-[10.5px] leading-6 sm:p-5 sm:text-[11px]">
        <div className="text-white/45">vault/</div>
        <div className="text-white/80">├── notes/</div>
        <div className="pl-7 text-white/55">│   ├── research-index.md</div>
        <div className="pl-7 text-white/55">│   ├── product-brief.md</div>
        <div className="pl-7 text-white/55">│   └── reading-list.md</div>
        <div className="text-white/80">├── databases/</div>
        <div className="pl-7 text-white/55">│   └── reading-list.json</div>
        <div className="text-white/80">└── database-views/</div>
        <div className="pl-7 text-white/55">    └── reading-list/</div>
        <Separator className="my-3.5 bg-white/10" />
        <div className="text-white/40">---</div>
        <div><span className="text-[#7fbfa6]">title</span>: Research index</div>
        <div><span className="text-[#7fbfa6]">id</span>: 7c9e4a2d-…</div>
        <div className="text-white/40">---</div>
        <div className="mt-2 text-white/75">A map of <span className="text-[#7fbfa6]">[[local-first]]</span> tools.</div>
      </div>
    </div>
  );
}

function Ownership() {
  return (
    <section id="philosophy" className="scroll-mt-20 border-t border-border">
      <div className="mx-auto max-w-6xl px-5 py-16 sm:py-24">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)] lg:items-center lg:gap-20">
          <div>
            <h2 className="max-w-[18ch] text-[clamp(2rem,4.2vw,3.25rem)] leading-[1.04] font-semibold tracking-[-0.04em] text-balance">
              Nothing between you and your files.
            </h2>
            <p className="mt-4 max-w-[56ch] text-base leading-7 text-muted-foreground">
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
                  Optional storage and sync providers. Sync remains experimental and is not wired into the workspace.
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
          <div className="absolute top-4 right-[16%] left-[16%] hidden border-t border-dashed border-border md:block" aria-hidden="true" />
          <ol className="relative grid gap-8 md:grid-cols-3 md:gap-0">
            {steps.map((step) => (
              <li key={step.number} className="relative md:px-6 md:first:pl-0 md:last:pr-0">
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

function OpenSourceCta() {
  return (
    <section className="border-t border-border bg-foreground text-background">
      <div className="relative mx-auto max-w-6xl overflow-hidden px-5 py-16 sm:py-20">
        <svg
          viewBox="0 0 640 240"
          className="pointer-events-none absolute top-1/2 right-[-6%] hidden w-[520px] -translate-y-1/2 text-background/15 sm:block"
          fill="none"
          aria-hidden="true"
        >
          <path d="M92 120 238 42M238 42l166 26M404 68l126 76M126 184l278-116M158 208l366-82" stroke="currentColor" />
          <circle cx="92" cy="120" r="5" fill="currentColor" />
          <circle cx="238" cy="42" r="7" fill="currentColor" />
          <circle cx="404" cy="68" r="5" fill="currentColor" />
          <circle cx="530" cy="144" r="7" fill="currentColor" />
          <circle cx="126" cy="184" r="4" fill="currentColor" />
          <circle cx="158" cy="208" r="4" fill="currentColor" />
          <circle cx="524" cy="126" r="3" fill="currentColor" />
        </svg>
        <div className="relative max-w-[620px]">
          <h2 className="text-[clamp(2.1rem,4.8vw,3.6rem)] leading-[1.02] font-semibold tracking-[-0.04em] text-balance">
            Built in the open. Owned by you.
          </h2>
          <p className="mt-4 max-w-[54ch] text-base leading-7 text-background/65">
            Nodus is Apache-2.0 licensed. Read the code, run it locally, inspect the storage model, and help shape what comes next.
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <Button asChild className="h-11 bg-background px-4 text-sm text-foreground hover:bg-background/90 sm:h-10">
              <a href={GITHUB_URL} target="_blank" rel="noreferrer">
                <GithubMark data-icon="inline-start" />
                Explore the repository
                <ArrowUpRight data-icon="inline-end" aria-hidden="true" />
              </a>
            </Button>
            <Button asChild variant="outline" className="h-11 border-background/20 bg-transparent px-4 text-sm text-background hover:bg-background/10 hover:text-background sm:h-10">
              <a href={WORKSPACE_PATH}>
                Open the workspace
                <ArrowRight data-icon="inline-end" aria-hidden="true" />
              </a>
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

function LandingFooter() {
  return (
    <footer className="border-t border-border bg-background">
      <div className="mx-auto max-w-6xl px-5 py-10">
        <div className="flex flex-col gap-8 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <Wordmark />
            <p className="mt-3 max-w-[36ch] text-[13px] leading-6 text-muted-foreground">
              A local-first, Markdown-native knowledge workspace. Notes stay portable; structure stays yours.
            </p>
          </div>
          <nav aria-label="Footer" className="grid grid-cols-2 gap-x-10 gap-y-1 text-[13px]">
            <a className="inline-flex min-h-11 items-center text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href="#features">Features</a>
            <a className="inline-flex min-h-11 items-center text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href="#philosophy">Philosophy</a>
            <a className="inline-flex min-h-11 items-center text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href={WORKSPACE_PATH}>Workspace</a>
            <a className="inline-flex min-h-11 items-center text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href={GITHUB_URL} target="_blank" rel="noreferrer">GitHub</a>
          </nav>
        </div>
        <div className="mt-9 flex flex-col gap-2 border-t border-border pt-5 text-[12px] leading-5 text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span>Nodus · Apache-2.0 · Local-first by design</span>
          <span>Markdown is the format. Your filesystem is the database.</span>
        </div>
      </div>
    </footer>
  );
}

export default function LandingPage() {
  return (
    <div className="min-h-dvh bg-background text-foreground">
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
        <Workflow />
        <OpenSourceCta />
      </main>
      <LandingFooter />
    </div>
  );
}
