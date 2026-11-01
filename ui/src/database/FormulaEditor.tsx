import { lazy, Suspense } from 'react';
import type { Property } from '../../../src/database/schema.js';
import type { UiDatabaseRow } from '../../../src/ui-server/dto.js';
import type { FormulaDatabaseContext } from '../../../src/database/formula-engine.js';
import type { FormulaRelatedProperty } from './formula-editor-model.js';
import { Skeleton } from '@/components/ui/skeleton';

export interface FormulaEditorProps {
  property: Property;
  properties: readonly Property[];
  previewRow?: UiDatabaseRow;
  disabled?: boolean;
  databases?: readonly FormulaDatabaseContext[];
  currentDatabaseId?: string;
  relatedProperties?: readonly FormulaRelatedProperty[];
  onApply: (expression: string) => void;
  onCancel: () => void;
}

const FormulaEditorImplementation = lazy(() =>
  import('./FormulaEditorImpl.js').then((module) => ({ default: module.FormulaEditor })),
);

export function FormulaEditor(props: FormulaEditorProps) {
  return (
    <Suspense
      fallback={(
        <section
          role="status"
          aria-busy="true"
          aria-label={`Loading formula editor for ${props.property.name}`}
          className="flex min-w-0 flex-col gap-3 rounded-md border bg-muted/20 p-3"
        >
          <span className="sr-only">Loading formula editor…</span>
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-28 w-full" />
          <div className="grid gap-3 sm:grid-cols-2">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        </section>
      )}
    >
      <FormulaEditorImplementation {...props} />
    </Suspense>
  );
}
