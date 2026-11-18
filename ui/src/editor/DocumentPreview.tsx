import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { api } from '../api';

export function DocumentPreview({ path, name }: { path: string; name: string }) {
  const word = name.endsWith('.docx');
  const canvas = useRef<HTMLCanvasElement>(null);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(0);
  const [body, setBody] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    let dispose: (() => void) | undefined;
    setError(false);
    void (async () => {
      if (word) {
        const text = await api.docxPreview(path);
        if (active) setBody(text);
        return;
      }
      const [pdfjs, worker] = await Promise.all([
        import('pdfjs-dist'),
        import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
      ]);
      if (!active) return;
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      const task = pdfjs.getDocument({ url: api.attachmentUrl(path) });
      dispose = () => { void task.destroy(); };
      const pdf = await task.promise;
      const sheet = await pdf.getPage(page);
      if (!active || !canvas.current) return;
      const viewport = sheet.getViewport({ scale: 1.4 });
      canvas.current.width = Math.ceil(viewport.width);
      canvas.current.height = Math.ceil(viewport.height);
      await sheet.render({ canvas: canvas.current, viewport }).promise;
      if (active) setPages(pdf.numPages);
    })().catch(() => { if (active) setError(true); });
    return () => { active = false; dispose?.(); };
  }, [path, page, word]);

  if (word) return <div className="min-h-0 flex-1 overflow-auto rounded-md border p-4">
    {error ? <p role="alert">Could not preview this Word document.</p> : body === null ? <p role="status">Loading document…</p> : <div className="whitespace-pre-wrap break-words">{body.trim() || 'This document contains no readable text.'}</div>}
  </div>;

  return <>
    <div className="min-h-0 flex-1 overflow-auto rounded-md border bg-muted p-2">
      {error && <p role="alert">Could not render this PDF.</p>}
      {!error && pages === 0 && <p role="status">Loading PDF…</p>}
      <canvas key={page} ref={canvas} aria-label={`PDF page ${page}`} className="mx-auto block h-auto max-w-full bg-white" hidden={error} />
    </div>
    {pages > 1 && <div className="flex items-center justify-center gap-3">
      <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</Button>
      <span>Page {page} of {pages}</span>
      <Button variant="outline" size="sm" disabled={page === pages} onClick={() => setPage(page + 1)}>Next</Button>
    </div>}
  </>;
}
