/**
 * Node's ESM resolver does not understand extensionless subpath imports, while
 * Next's package ships no "exports" map. The app imports `next/server` the way
 * Next itself documents; this hook resolves it for the test process only.
 *
 * It also resolves the `@/*` path alias and extensionless lib imports, which
 * Next's bundler handles but plain Node does not.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const candidates = (url) => [
  url,
  new URL(`${url.href}.ts`, root),
  new URL(`${url.href}.tsx`, root),
  new URL(`${url.href}/index.ts`, root),
];

function firstFile(urls) {
  return urls.find((url) => existsSync(fileURLToPath(url)));
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'next/server') return nextResolve('next/server.js', context);
  if (specifier === 'next/headers') return nextResolve('next/headers.js', context);

  if (specifier.startsWith('@/')) {
    const url = new URL(specifier.slice(2), root);
    const resolved = firstFile(candidates(url));
    if (resolved) return nextResolve(resolved.href, context);
  }

  if (specifier.startsWith('.') && !/\.[cm]?[jt]sx?$/.test(specifier)) {
    const parent = new URL(context.parentURL ?? root.href);
    const url = new URL(specifier, parent);
    const resolved = firstFile(candidates(url));
    if (resolved) return nextResolve(resolved.href, context);
  }

  return nextResolve(specifier, context);
}
