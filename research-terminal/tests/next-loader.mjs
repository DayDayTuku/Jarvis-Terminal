/**
 * Node's ESM resolver does not understand extensionless subpath imports, while
 * Next's package ships no "exports" map. The app imports `next/server` the way
 * Next itself documents; this hook resolves it for the test process only.
 */
export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'next/server') return nextResolve('next/server.js', context);
  if (specifier === 'next/headers') return nextResolve('next/headers.js', context);
  return nextResolve(specifier, context);
}
