import { useRef, useState } from 'react';
import { Bold, Code, Italic, List, ListOrdered, Pilcrow, Quote, Strikethrough, Type } from 'lucide-react';
import type { StateCommand } from '@codemirror/state';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import { insertCodeBlock, insertMarkdownLink, toggleBlockquote, toggleBold, toggleHeading, toggleInlineCode, toggleItalic, toggleList, toggleStrikethrough } from './markdownCommands';

const inlineActions = [
  { label: 'Bold', icon: Bold, command: toggleBold },
  { label: 'Italic', icon: Italic, command: toggleItalic },
  { label: 'Strikethrough', icon: Strikethrough, command: toggleStrikethrough },
  { label: 'Inline code', icon: Code, command: toggleInlineCode },
  { label: 'Blockquote', icon: Quote, command: toggleBlockquote },
  { label: 'Bulleted list', icon: List, command: toggleList(false) },
  { label: 'Numbered list', icon: ListOrdered, command: toggleList(true) },
  { label: 'Paragraph', icon: Pilcrow, command: toggleHeading(0) },
];

export function MarkdownToolbar({ onCommand, onFocus }: { onCommand: (command: StateCommand) => boolean; onFocus: () => void }) {
  const [open, setOpen] = useState(false);
  const [language, setLanguage] = useState('');
  const [destination, setDestination] = useState('');
  const [feedback, setFeedback] = useState('');
  const restoreEditor = useRef(false);
  const validLanguage = /^[\w.+#-]{0,64}$/.test(language);

  const apply = (command: StateCommand) => {
    if (!onCommand(command)) {
      setFeedback('This action does not apply here. Keep wiki links intact and use a code block for multiline code.');
      return;
    }
    restoreEditor.current = true;
    setOpen(false);
  };

  return (
    <div className="mb-2 flex items-center">
      <Popover open={open} onOpenChange={(value) => { setOpen(value); setFeedback(''); }}>
        <PopoverTrigger asChild>
          <Button type="button" variant="ghost" size="xs" aria-label="Format Markdown"><Type data-icon="inline-start" />Format</Button>
        </PopoverTrigger>
        <PopoverContent align="start" aria-label="Markdown formatting" className="flex max-h-[70dvh] w-80 max-w-[calc(100vw-2rem)] flex-col gap-3 overflow-y-auto"
          onCloseAutoFocus={(event) => {
            if (restoreEditor.current) { event.preventDefault(); restoreEditor.current = false; onFocus(); }
          }}>
          <div className="flex flex-col gap-1">
            <h2 className="text-sm font-medium">Format Markdown</h2>
            <p className="text-xs text-muted-foreground">Apply to the selection or current line. Undo restores the source.</p>
          </div>
          <div className="grid grid-cols-2 gap-1" role="group" aria-label="Text and lists">
            {inlineActions.map(({ label, icon: Icon, command }) => <Button key={label} type="button" variant="ghost" size="sm" className="justify-start" onClick={() => apply(command)}><Icon data-icon="inline-start" />{label}</Button>)}
          </div>
          <div className="grid grid-cols-6 gap-1" role="group" aria-label="Headings">
            {Array.from({ length: 6 }, (_, index) => <Button key={index} type="button" variant="outline" size="xs" aria-label={`Heading ${index + 1}`} onClick={() => apply(toggleHeading(index + 1))}>H{index + 1}</Button>)}
          </div>
          <Separator />
          <div className="flex flex-col gap-1.5">
            <label htmlFor="markdown-code-language" className="text-xs font-medium">Code language (optional)</label>
            <Input id="markdown-code-language" value={language} placeholder="e.g. typescript" aria-invalid={!validLanguage} onChange={(event) => setLanguage(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && validLanguage) { event.preventDefault(); apply(insertCodeBlock(language)); } }} />
            {!validLanguage && <p role="alert" className="text-xs text-destructive">Use up to 64 letters, numbers, dots, +, #, underscores or hyphens.</p>}
            <Button type="button" variant="outline" size="sm" disabled={!validLanguage} onClick={() => apply(insertCodeBlock(language))}>Code block</Button>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="markdown-link-destination" className="text-xs font-medium">Link destination (optional)</label>
            <Input id="markdown-link-destination" value={destination} placeholder="https:// or a relative path" onChange={(event) => setDestination(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); apply(insertMarkdownLink(destination)); } }} />
            <Button type="button" variant="outline" size="sm" onClick={() => apply(insertMarkdownLink(destination))}>Insert or edit link</Button>
          </div>
          {feedback && <p role="status" className="text-xs text-muted-foreground">{feedback}</p>}
        </PopoverContent>
      </Popover>
    </div>
  );
}
