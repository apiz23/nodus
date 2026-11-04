import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { serializeDatabase, type DatabaseDefinition } from '../src/database/schema.js';
import { serializeDatabaseView, type DatabaseView } from '../src/database/database-view.js';
import { databasePath, databaseViewPath } from '../src/storage/fs/layout.js';
import { FileSystemVault } from '../src/storage/fs/vault.js';
import { previewImport } from '../src/storage/portable/import.js';
import { withTempDir } from './tmp.js';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '99999999-9999-4999-8999-999999999999';
const REL = '33333333-3333-4333-8333-333333333333';
const ROLL = '44444444-4444-4444-8444-444444444444';
const FORMULA = '55555555-5555-4555-8555-555555555555';
const MISSING = '66666666-6666-4666-8666-666666666666';
const VIEW = '77777777-7777-4777-8777-777777777777';

describe('portable database preview diagnostics', () => {
  it('reuses relation, formula, rollup, saved-view, grouping, filter, and Calendar diagnostics with resource identity', async () => {
    await withTempDir(async (root) => {
      const source = join(root, 'source');
      const target = await FileSystemVault.open(join(root, 'target'));
      const schemas: DatabaseDefinition[] = [
        {
          id: A,
          name: 'Source schema',
          properties: [
            { id: REL, name: 'Related', type: 'relation', relation: { databaseId: C, cardinality: 'many', reversePropertyId: MISSING } },
            { id: ROLL, name: 'Missing relation rollup', type: 'rollup', rollup: { relationPropertyId: MISSING, operation: 'sum', targetPropertyId: FORMULA } },
            { id: FORMULA, name: 'Broken formula reference', type: 'formula', formula: { expression: `@{${MISSING}}` } },
          ],
        },
        { id: B, name: 'Target schema', properties: [] },
      ];
      await mkdir(join(source, 'databases'), { recursive: true });
      for (const schema of schemas) await writeFile(join(source, databasePath(schema.id)), serializeDatabase(schema));
      await mkdir(join(source, 'database-views', A), { recursive: true });
      const view: DatabaseView = {
        id: VIEW, databaseId: A, name: 'Broken calendar', type: 'calendar', settings: { startDatePropertyId: MISSING, endDatePropertyId: REL },
        sort: { propertyId: MISSING, direction: 'asc' }, sorts: [{ propertyId: MISSING, direction: 'asc' }],
        filters: [{ id: '88888888-8888-4888-8888-888888888888', propertyId: MISSING, operator: 'is-empty' }], visiblePropertyIds: [MISSING],
      };
      await writeFile(join(source, databaseViewPath(A, VIEW)), serializeDatabaseView(view));
      const groupedView: DatabaseView = {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', databaseId: A, name: 'Broken table', type: 'table', settings: { groupPropertyId: REL },
        sort: { propertyId: REL, direction: 'asc' }, sorts: [{ propertyId: REL, direction: 'asc' }],
        filters: [{ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', propertyId: REL, operator: 'is-empty' }], visiblePropertyIds: [REL],
      };
      await writeFile(join(source, databaseViewPath(A, groupedView.id)), serializeDatabaseView(groupedView));

      const preview = await previewImport(source, target);
      expect(preview.errors).toEqual([]);
      const messages = preview.warnings.join('\n');
      expect(messages).toContain(`Database ${A} property ${REL} targets missing database ${C}`);
      expect(messages).toContain('Reverse relation must reference a forward relation');
      expect(messages).toContain('Rollup requires an existing relation and target database');
      expect(messages).toContain('Unknown property reference');
      expect(messages).toContain(`Saved view ${VIEW}`);
      expect(messages).toContain('calendar requires a Date property');
      expect(messages).toContain(`Saved view ${groupedView.id}`);
      expect(messages).toContain('Grouping requires a Select, Checkbox, or Formula property');
      expect(messages).toContain('Empty filter is incompatible');
      target.dispose();
    });
  });

  it('rejects database templates with missing saved-view property references and names the resource path', async () => {
    await withTempDir(async (root) => {
      const source = join(root, 'source');
      const target = await FileSystemVault.open(join(root, 'target'));
      const catalog = {
        format: 'nodus-templates', version: 1,
        templates: [{
          id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', type: 'database', name: 'Broken database template',
          database: { id: A, name: 'Template database', properties: [{ id: REL, name: 'Relation', type: 'relation', relation: { databaseId: B, cardinality: 'many' } }] },
          views: [{ id: VIEW, databaseId: A, name: 'Missing field', type: 'table', settings: {}, sort: { propertyId: 'title', direction: 'asc' }, sorts: [{ propertyId: 'title', direction: 'asc' }], filters: [], visiblePropertyIds: [MISSING] }],
          starterRows: [], createdAt: '2026-11-04T00:00:00Z', updatedAt: '2026-11-04T00:00:00Z',
        }],
      };
      await mkdir(join(source, '.nodus-templates'), { recursive: true });
      await writeFile(join(source, '.nodus-templates', 'templates.json'), `${JSON.stringify(catalog)}\n`);
      await expect(previewImport(source, target)).rejects.toMatchObject({ code: 'INVALID_CONTENT', path: '.nodus-templates/templates.json' });
      target.dispose();
    });
  });
});
