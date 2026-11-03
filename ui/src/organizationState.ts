const FORMAT_VERSION = 1;
export type OrganizationStatus = 'dismissed' | 'reviewed';
export interface OrganizationStatuses { entries: Record<string, OrganizationStatus>; issue?: string }

export function organizationStatusKey(vaultIdentity: string): string {
  return `nodus:organization-status:v${FORMAT_VERSION}:${vaultIdentity}`;
}

/** Stores only suggestion IDs/statuses, never titles, paths, or note content. */
export function readOrganizationStatuses(storage: Pick<Storage, 'getItem'>, vaultIdentity: string): OrganizationStatuses {
  try {
    const raw = storage.getItem(organizationStatusKey(vaultIdentity));
    if (raw === null) return { entries: {} };
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || parsed.version !== FORMAT_VERSION || !isRecord(parsed.entries)) {
      return { entries: {}, issue: 'Saved suggestion states were invalid and have been ignored.' };
    }
    const entries: Record<string, OrganizationStatus> = {};
    for (const [id, status] of Object.entries(parsed.entries)) {
      if (/^[a-f0-9]{24}$/.test(id) && (status === 'dismissed' || status === 'reviewed')) entries[id] = status;
    }
    return { entries };
  } catch {
    return { entries: {}, issue: 'Saved suggestion states could not be read. Suggestions are still available.' };
  }
}

export function writeOrganizationStatuses(storage: Pick<Storage, 'setItem'>, vaultIdentity: string, entries: Record<string, OrganizationStatus>): void {
  const valid = Object.fromEntries(Object.entries(entries).filter(([id, status]) =>
    /^[a-f0-9]{24}$/.test(id) && (status === 'dismissed' || status === 'reviewed')));
  storage.setItem(organizationStatusKey(vaultIdentity), JSON.stringify({ version: FORMAT_VERSION, entries: valid }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
