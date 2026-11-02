import { describe, expect, it } from 'vitest';
import { parseTemplate, parseTemplates, resolveNoteTemplate, serializeTemplates, type NoteTemplate } from '../src/database/templates.js';
import { FileSystemVault } from '../src/storage/fs/vault.js';
import { exportVault } from '../src/storage/portable/export.js';
import { applyImport, planImport } from '../src/storage/portable/import.js';
import { createBackup, restoreBackup, validateBackup } from '../src/storage/backup/backup.js';
import { withTempDir } from './tmp.js';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const NOW = '2026-11-02T00:00:00.000Z';
const NOTE_TEMPLATE: NoteTemplate = {
  id: '11111111-1111-4111-8111-111111111111', type: 'note', name: 'Meeting notes', title: 'Meeting {{date}}',
  body: '# {{topic}}\n\nAttendees:\n', tags: ['meetings'], aliases: [], frontmatter: { project: '{{topic}}' },
  variables: [{ name: 'date', type: 'date', required: true }, { name: 'topic', type: 'text', required: true }], createdAt: NOW, updatedAt: NOW,
};

describe('database templates', () => {
  it('validates strict versioned catalogs and renders declared variables deterministically', () => {
    const encoded = serializeTemplates([NOTE_TEMPLATE]);
    expect(parseTemplates(encoded)).toEqual([NOTE_TEMPLATE]);
    expect(resolveNoteTemplate(NOTE_TEMPLATE, { date: '2026-11-02', topic: 'Planning' })).toMatchObject({ title: 'Meeting 2026-11-02', body: expect.stringContaining('# Planning'), frontmatter: { project: 'Planning' } });
    expect(() => resolveNoteTemplate(NOTE_TEMPLATE, { unknown: 'x' })).toThrow(/Unknown template variable/);
    expect(() => resolveNoteTemplate(NOTE_TEMPLATE, { date: 'tomorrow', topic: 'Planning' })).toThrow(/YYYY-MM-DD/);
    expect(() => parseTemplate({ ...NOTE_TEMPLATE, frontmatter: { nodus_data: {} } })).toThrow(/reserved/);
    expect(() => parseTemplates(JSON.stringify({ format: 'nodus-templates', version: 2, templates: [] }))).toThrow(/version 2.*current version: 1/);
    expect(() => parseTemplates(JSON.stringify({ format: 'nodus-templates', version: 1, templates: [{ ...NOTE_TEMPLATE, future: true }] }))).toThrow(/unsupported field/);
  });

  it('persists with stale-write protection and survives export/import and backup/restore', async () => {
    await withTempDir(async (dir) => {
      const source = await FileSystemVault.open(join(dir, 'source'));
      const saved = await source.writeTemplates([NOTE_TEMPLATE], null);
      expect((await source.readTemplates()).templates).toEqual([NOTE_TEMPLATE]);
      await expect(source.writeTemplates([], null)).rejects.toMatchObject({ code: 'STALE_WRITE' });

      const exportDir = join(dir, 'export');
      expect(await exportVault(source, exportDir)).toMatchObject({ templateFiles: 1 });
      const imported = await FileSystemVault.open(join(dir, 'imported'));
      const importPlan = await planImport(exportDir);
      expect(importPlan.entries.map((entry) => entry.kind)).toContain('template-catalog');
      expect(await applyImport(imported, importPlan)).toMatchObject({ templateFiles: 1 });
      expect((await imported.readTemplates()).templates).toEqual([NOTE_TEMPLATE]);

      const backupDir = join(dir, 'backup');
      expect(await createBackup(source, backupDir)).toMatchObject({ templateFiles: 1 });
      const validation = await validateBackup(backupDir);
      expect(validation.manifest.version).toBe(7);
      expect(validation.entries.map((entry) => entry.kind)).toContain('template-catalog');
      const restored = await FileSystemVault.open(join(dir, 'restored'));
      expect(await restoreBackup(backupDir, restored.root)).toMatchObject({ templateFiles: 1 });
      expect((await restored.readTemplates()).templates).toEqual([NOTE_TEMPLATE]);
      expect(saved.hash).toBe((await restored.readTemplates()).hash);
    });
  });

  it('rejects invalid persisted catalogs without rewriting their bytes', async () => {
    await withTempDir(async (dir) => {
      const vault = await FileSystemVault.open(join(dir, 'vault'));
      const invalid = '{"format":"nodus-templates","version":1,"templates":[{"bad":true}]}\n';
      await mkdir(join(vault.root, '.nodus-templates'), { recursive: true });
      await writeFile(join(vault.root, '.nodus-templates/templates.json'), invalid);
      await expect(vault.readTemplates()).rejects.toMatchObject({ code: 'INVALID_CONTENT' });
      const { readFile } = await import('node:fs/promises');
      expect(await readFile(join(vault.root, '.nodus-templates/templates.json'), 'utf8')).toBe(invalid);
    });
  });
});
