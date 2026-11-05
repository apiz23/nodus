import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

register(new URL('./import-process-ts-loader.mjs', import.meta.url), pathToFileURL(`${process.cwd()}/`));
