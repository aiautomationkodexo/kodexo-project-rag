/**
 * Test bootstrap. Loaded with `node --import ./tests/setup.mts`.
 *
 * Two things stand between `node --test` and this codebase:
 *
 *   1. Specifiers written for a bundler. Next resolves `@/lib/env` via
 *      tsconfig `paths` (which Node does not read) and `./schemas` without an
 *      extension (which Node ESM requires). The hook below does both, so
 *      application modules can be imported by tests exactly as they are
 *      written rather than being reshaped to suit the test runner.
 *
 *   2. `server-only`. Its exports map resolves to a module that throws on
 *      import unless the `react-server` condition is set. The test scripts pass
 *      --conditions=react-server, which selects the package's own empty.js —
 *      the same no-op React uses on the server. That is what lets a test import
 *      pipeline and ai modules directly instead of forcing every testable
 *      helper out into a separate file to dodge the marker.
 */
import { registerHooks } from "node:module";
import { statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SRC = path.resolve(import.meta.dirname, "..", "src");

/** TypeScript source omits extensions; Node ESM requires them. */
function withExtension(base: string): string | null {
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
  ];
  for (const candidate of candidates) {
    // isFile(), not exists(): `@/lib/tags` names a directory as well as
    // nothing importable, and handing a directory to Node yields a far more
    // confusing error than falling through to the real resolver.
    if (statSync(candidate, { throwIfNoEntry: false })?.isFile()) return candidate;
  }
  return null;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      const resolved = withExtension(path.join(SRC, specifier.slice(2)));
      if (resolved) return nextResolve(pathToFileURL(resolved).href, context);
    }

    // Relative specifiers inside application modules are extensionless too.
    // Only rewritten when the extensionless form actually names a file on
    // disk, so a genuine miss still reports the specifier the author wrote.
    if (
      (specifier.startsWith("./") || specifier.startsWith("../")) &&
      context.parentURL?.startsWith("file:") &&
      !path.extname(specifier)
    ) {
      const base = path.resolve(
        path.dirname(fileURLToPath(context.parentURL)),
        specifier,
      );
      const resolved = withExtension(base);
      if (resolved) return nextResolve(pathToFileURL(resolved).href, context);
    }

    return nextResolve(specifier, context);
  },
});
