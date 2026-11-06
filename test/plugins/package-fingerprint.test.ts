import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { fingerprintPluginInventory } from '../../src/plugins/package-inventory.js';
import type { PluginPackageFile } from '../../src/plugins/types.js';

const file = (path: string, content: string): PluginPackageFile => ({
  path,
  size: Buffer.byteLength(content),
  sha256: createHash('sha256').update(content).digest('hex'),
});

describe('plugin package fingerprint', () => {
  it('is deterministic regardless of input file order', () => {
    const files = [file('z.mjs', 'z'), file('nodus-plugin.json', '{}'), file('a.mjs', 'a')];
    expect(fingerprintPluginInventory(files)).toBe(fingerprintPluginInventory([...files].reverse()));
    const sorted = [files[2]!, files[1]!, files[0]!].map(({ path, size, sha256 }) => [path, size, sha256]);
    const expected = createHash('sha256').update(`nodus-plugin-package-v1\n${JSON.stringify(sorted)}`, 'utf8').digest('hex');
    expect(fingerprintPluginInventory(files)).toBe(expected);
  });

  it('changes when content, file names, additions, or removals change', () => {
    const initial = [file('a.mjs', 'one')];
    const fingerprint = fingerprintPluginInventory(initial);
    expect(fingerprintPluginInventory([file('a.mjs', 'two')])).not.toBe(fingerprint);
    expect(fingerprintPluginInventory([file('b.mjs', 'one')])).not.toBe(fingerprint);
    expect(fingerprintPluginInventory([...initial, file('b.mjs', 'two')])).not.toBe(fingerprint);
    expect(fingerprintPluginInventory([])).not.toBe(fingerprint);
  });
});
