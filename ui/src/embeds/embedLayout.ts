import type { DatabaseView } from '../../../src/database/database-view';
import type { Property } from '../../../src/database/schema';

/**
 * Maps a saved view's layout to a renderer the embed can actually honour.
 * The embed never silently substitutes a table for a board or calendar: an
 * unsupported configuration returns a reason that the UI shows instead.
 */
export type EmbedLayout =
  | { kind: 'table' }
  | { kind: 'list'; groupProperty?: Property }
  | { kind: 'kanban'; groupProperty: Property }
  | { kind: 'gallery' }
  | { kind: 'calendar'; startProperty: Property; endProperty?: Property }
  | { kind: 'unsupported'; requested: string; reason: string };

function propertyById(properties: readonly Property[], id: string | undefined): Property | undefined {
  return id === undefined ? undefined : properties.find((property) => property.id === id);
}

export function resolveEmbedLayout(view: DatabaseView, properties: readonly Property[]): EmbedLayout {
  const requested = view.type ?? 'table';
  switch (requested) {
    case 'table':
      return { kind: 'table' };
    case 'gallery':
      return { kind: 'gallery' };
    case 'list': {
      const group = propertyById(properties, view.settings?.groupPropertyId);
      return group === undefined ? { kind: 'list' } : { kind: 'list', groupProperty: group };
    }
    case 'kanban': {
      const group = propertyById(properties, view.settings?.groupPropertyId);
      if (group === undefined) return { kind: 'unsupported', requested, reason: 'This board view has no grouping property configured.' };
      if (group.type !== 'select') return { kind: 'unsupported', requested, reason: `The grouping property "${group.name}" is not a Select property.` };
      return { kind: 'kanban', groupProperty: group };
    }
    case 'calendar': {
      const startId = view.settings?.startDatePropertyId ?? view.settings?.datePropertyId;
      const start = propertyById(properties, startId);
      if (start === undefined) return { kind: 'unsupported', requested, reason: 'This calendar view has no start date property configured.' };
      if (start.type !== 'date') return { kind: 'unsupported', requested, reason: `The start property "${start.name}" is not a Date property.` };
      const end = propertyById(properties, view.settings?.endDatePropertyId);
      if (end !== undefined && end.type !== 'date') return { kind: 'unsupported', requested, reason: `The end property "${end.name}" is not a Date property.` };
      return { kind: 'calendar', startProperty: start, endProperty: end };
    }
    default:
      return { kind: 'unsupported', requested, reason: `Layout "${requested}" is not supported in embedded views.` };
  }
}
