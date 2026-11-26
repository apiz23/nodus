import type { DatabaseView } from './database-view.js';
import type { Property } from './schema.js';
import type { DatabaseTemplate } from './templates.js';

const id = (suffix: number) => `b31a0000-0000-4000-8000-${String(suffix).padStart(12, '0')}`;
const projectsId = id(1);
const workItemsId = id(2);
const typeId = id(3);
const statusId = id(4);
const priorityId = id(5);
const bugId = id(7);
const dateId = id(20);

const properties: Property[] = [
  { id: typeId, name: 'Type', type: 'select', options: [{ id: id(6), name: 'Task' }, { id: bugId, name: 'Bug' }] },
  { id: statusId, name: 'Status', type: 'select', options: [
    { id: id(8), name: 'To do' }, { id: id(9), name: 'In progress' }, { id: id(10), name: 'Done' },
  ] },
  { id: priorityId, name: 'Priority', type: 'select', options: [
    { id: id(11), name: 'Low' }, { id: id(12), name: 'Normal' }, { id: id(13), name: 'High' },
  ] },
  { id: dateId, name: 'Date', type: 'date' },
];

const workItemView = {
  databaseId: workItemsId,
  sort: { propertyId: 'title', direction: 'asc' },
  visiblePropertyIds: properties.map(({ id }) => id),
} satisfies Pick<DatabaseView, 'databaseId' | 'sort' | 'visiblePropertyIds'>;

export function projectManagementTemplates(now: string): DatabaseTemplate[] {
  const timestamps = { createdAt: now, updatedAt: now };
  return [
    {
      ...timestamps,
      id: id(14), name: 'Projects', type: 'database',
      database: { id: projectsId, name: 'Projects', properties: [] },
      views: [], starterRows: [],
    },
    {
      ...timestamps,
      id: id(15), name: 'Work Items', type: 'database',
      database: { id: workItemsId, name: 'Work Items', properties },
      views: [
        { ...workItemView, id: id(16), name: 'All Work Items', type: 'table', settings: {}, filters: [] },
        { ...workItemView, id: id(17), name: 'Status board', type: 'kanban', settings: { groupPropertyId: statusId }, filters: [] },
        { ...workItemView, id: id(21), name: 'Calendar', type: 'calendar', settings: { startDatePropertyId: dateId }, filters: [] },
        { ...workItemView, id: id(18), name: 'Bugs', type: 'table', settings: {},
          filters: [{ id: id(19), propertyId: typeId, operator: 'is', value: bugId }] },
      ],
      starterRows: [],
    },
  ];
}
