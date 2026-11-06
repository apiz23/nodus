import type { PluginDependencyInput, PluginDependencyResolution, PluginDiagnostic } from './types.js';
import { satisfiesVersionRange } from './versions.js';

export function resolvePluginDependencies(input: readonly PluginDependencyInput[]): PluginDependencyResolution {
  const diagnostics: PluginDiagnostic[] = [];
  const byId = new Map<string, PluginDependencyInput[]>();
  for (const plugin of input) byId.set(plugin.id, [...(byId.get(plugin.id) ?? []), plugin]);

  const invalid = new Set<string>();
  for (const [id, matches] of byId) {
    if (matches.length > 1) {
      invalid.add(id);
      diagnostics.push({ code: 'PLUGIN_ID_DUPLICATE', severity: 'error', pluginId: id, message: `Plugin ID "${id}" is present in more than one local package.` });
    }
    if (matches.some((plugin) => plugin.initiallyValid === false)) invalid.add(id);
  }

  const edges = new Map<string, Set<string>>();
  for (const plugin of input) {
    if (byId.get(plugin.id)?.length !== 1 || plugin.initiallyValid === false) continue;
    const dependencies = [...plugin.dependencies].sort((left, right) => compare(left.id, right.id));
    const seen = new Set<string>();
    for (const dependency of dependencies) {
      if (seen.has(dependency.id)) {
        diagnostics.push({ code: 'DEPENDENCY_DUPLICATE', severity: 'error', pluginId: plugin.id, field: 'dependencies', message: `Dependency "${dependency.id}" is declared more than once.` });
        invalid.add(plugin.id);
        continue;
      }
      seen.add(dependency.id);
      if (dependency.id === plugin.id) {
        diagnostics.push({ code: 'DEPENDENCY_CYCLE', severity: 'error', pluginId: plugin.id, field: 'dependencies', message: 'A plugin cannot depend on itself.' });
        invalid.add(plugin.id);
        continue;
      }
      const target = byId.get(dependency.id);
      if (!target || target.length === 0) {
        diagnostics.push({ code: dependency.optional ? 'DEPENDENCY_MISSING' : 'DEPENDENCY_MISSING', severity: dependency.optional ? 'warning' : 'error', pluginId: plugin.id, field: 'dependencies', message: `${dependency.optional ? 'Optional' : 'Required'} dependency "${dependency.id}" was not discovered locally.` });
        if (!dependency.optional) invalid.add(plugin.id);
        continue;
      }
      if (target.length !== 1) {
        diagnostics.push({ code: 'DEPENDENCY_INVALID', severity: dependency.optional ? 'warning' : 'error', pluginId: plugin.id, field: 'dependencies', message: `Dependency "${dependency.id}" has a duplicate local identity and cannot be resolved.` });
        if (!dependency.optional) invalid.add(plugin.id);
        continue;
      }
      if (target[0]!.initiallyValid === false) {
        diagnostics.push({ code: 'DEPENDENCY_INVALID', severity: dependency.optional ? 'warning' : 'error', pluginId: plugin.id, field: 'dependencies', message: `Local dependency "${dependency.id}" is invalid and cannot be used.` });
        if (!dependency.optional) invalid.add(plugin.id);
        continue;
      }
      if (!satisfiesVersionRange(target[0]!.version, dependency.range)) {
        diagnostics.push({ code: 'DEPENDENCY_VERSION_MISMATCH', severity: dependency.optional ? 'warning' : 'error', pluginId: plugin.id, field: 'dependencies', message: `Local dependency "${dependency.id}" version ${target[0]!.version} does not satisfy ${dependency.range}.` });
        if (!dependency.optional) invalid.add(plugin.id);
        continue;
      }
      const list = edges.get(plugin.id) ?? new Set<string>();
      list.add(dependency.id);
      edges.set(plugin.id, list);
    }
  }

  for (const id of findCycleMembers(input, edges, invalid)) {
    invalid.add(id);
    diagnostics.push({ code: 'DEPENDENCY_CYCLE', severity: 'error', pluginId: id, field: 'dependencies', message: `Plugin "${id}" is part of a local dependency cycle.` });
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const plugin of input) {
      if (invalid.has(plugin.id) || byId.get(plugin.id)?.length !== 1 || plugin.initiallyValid === false) continue;
      const invalidRequired = plugin.dependencies.find((dependency) => !dependency.optional && invalid.has(dependency.id));
      if (!invalidRequired) continue;
      invalid.add(plugin.id);
      changed = true;
      diagnostics.push({ code: 'DEPENDENCY_INVALID', severity: 'error', pluginId: plugin.id, field: 'dependencies', message: `Required dependency "${invalidRequired.id}" is invalid; this plugin cannot be used.` });
    }
  }

  const validIds = [...byId.entries()].filter(([id, matches]) => matches.length === 1 && !invalid.has(id) && matches[0]!.initiallyValid !== false).map(([id]) => id).sort(compare);
  const indegree = new Map(validIds.map((id) => [id, 0]));
  const dependents = new Map(validIds.map((id) => [id, new Set<string>()]));
  for (const id of validIds) {
    for (const dependencyId of edges.get(id) ?? []) {
      if (!indegree.has(dependencyId)) continue;
      indegree.set(id, (indegree.get(id) ?? 0) + 1);
      dependents.get(dependencyId)?.add(id);
    }
  }
  const ready = validIds.filter((id) => indegree.get(id) === 0).sort(compare);
  const order: string[] = [];
  while (ready.length > 0) {
    const id = ready.shift()!;
    order.push(id);
    for (const dependent of [...(dependents.get(id) ?? [])].sort(compare)) {
      const next = (indegree.get(dependent) ?? 0) - 1;
      indegree.set(dependent, next);
      if (next === 0) { ready.push(dependent); ready.sort(compare); }
    }
  }

  diagnostics.sort((left, right) => compare(left.pluginId ?? '', right.pluginId ?? '') || compare(left.code, right.code) || compare(left.field ?? '', right.field ?? '') || compare(left.message, right.message));
  return { order, invalidPluginIds: [...invalid].sort(compare), diagnostics };
}

function findCycleMembers(input: readonly PluginDependencyInput[], edges: ReadonlyMap<string, ReadonlySet<string>>, alreadyInvalid: ReadonlySet<string>): Set<string> {
  const state = new Map<string, 0 | 1 | 2>();
  const stack: string[] = [];
  const cycles = new Set<string>();
  const visit = (id: string) => {
    state.set(id, 1);
    stack.push(id);
    for (const target of [...(edges.get(id) ?? [])].sort(compare)) {
      if (alreadyInvalid.has(target)) continue;
      const targetState = state.get(target) ?? 0;
      if (targetState === 0) visit(target);
      else if (targetState === 1) {
        const start = stack.lastIndexOf(target);
        for (const member of stack.slice(Math.max(0, start))) cycles.add(member);
      }
    }
    stack.pop();
    state.set(id, 2);
  };
  for (const id of input.map((plugin) => plugin.id).sort(compare)) {
    if (alreadyInvalid.has(id) || (state.get(id) ?? 0) !== 0) continue;
    visit(id);
  }
  return cycles;
}

function compare(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
