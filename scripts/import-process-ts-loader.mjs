import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

export async function resolve(specifier, context, nextResolve) {
  if (!specifier.endsWith('.js') || !context.parentURL?.startsWith('file:')) return nextResolve(specifier, context);
  const candidate = new URL(specifier, context.parentURL);
  const javascriptPath = fileURLToPath(candidate);
  const typescriptPath = javascriptPath.replace(/\.js$/, '.ts');
  if (!existsSync(javascriptPath) && existsSync(typescriptPath)) return nextResolve(pathToFileURL(typescriptPath).href, context);
  return nextResolve(specifier, context);
}
