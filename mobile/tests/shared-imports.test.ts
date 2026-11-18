import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

// F-18 (see docs/round6-contract-notes.md §7): mobile may only use TYPES from @fintech-wallet/shared. Babel erases type
// imports, so Metro never bundles shared's source; a value import would make Metro resolve packages/shared/src/index.ts,
// whose `./money.js`-style specifiers point at `.ts` files Metro does not rewrite, and the bundle would fail. These
// checks are cheap guards; they do not replace building the app (`npm run build` in mobile/).
const MOBILE = resolve(__dirname, '..');
const SOURCE_ROOTS = ['App.tsx', 'app', 'src', 'tests'];

function sourceFiles(path: string): string[] {
  const full = join(MOBILE, path);
  if (statSync(full).isFile()) return [full];
  return readdirSync(full).flatMap((entry) => (entry === 'node_modules' ? [] : sourceFiles(join(path, entry)))).filter((file) => /\.(ts|tsx|js|jsx)$/.test(file));
}

// Every statement that names the shared package (static import/export, side-effect import, dynamic import, require).
export function sharedReferences(code: string): string[] {
  const pattern = /(?:^|\n)\s*(?:import|export)\b[^;]*?from\s*['"](?:@fintech-wallet\/shared|[./]*packages\/shared)[^'"]*['"]|(?:^|\n)\s*import\s*['"](?:@fintech-wallet\/shared|[./]*packages\/shared)[^'"]*['"]|\b(?:import|require)\s*\(\s*['"](?:@fintech-wallet\/shared|[./]*packages\/shared)[^'"]*['"]\s*\)/g;
  return [...code.matchAll(pattern)].map((match) => match[0].trim());
}
const isTypeOnly = (statement: string) => /^(?:import|export)\s+type\s/.test(statement);

describe('F-18: mobile uses only types from @fintech-wallet/shared', () => {
  it('every reference to the shared package in mobile code is `import type` / `export type`', () => {
    const offenders: string[] = [];
    let typeImports = 0;
    for (const file of SOURCE_ROOTS.flatMap(sourceFiles)) {
      if (file === __filename) continue;
      for (const statement of sharedReferences(readFileSync(file, 'utf8'))) {
        if (isTypeOnly(statement)) typeImports += 1;
        else offenders.push(`${relative(MOBILE, file)}: ${statement.replace(/\s+/g, ' ')}`);
      }
    }
    assert.deepEqual(offenders, [], 'value imports of shared break the Metro bundle (see docs/round6-contract-notes.md §7)');
    assert.ok(typeImports >= 1, 'the scan sees the existing type import of ProductComponents');
  });

  it('the guard recognises value imports (self-check)', () => {
    const sample = [
      "import type { ProductComponents } from '@fintech-wallet/shared';",
      "import { parseMxnToMinor } from '@fintech-wallet/shared';",
      "import { type ProductComponents } from '@fintech-wallet/shared';",
      "import * as shared from '@fintech-wallet/shared';",
      "import '@fintech-wallet/shared';",
      "export { isValidClabe } from '../packages/shared/src/index';",
      "const lazy = import('@fintech-wallet/shared');",
      "const shared = require('@fintech-wallet/shared');",
    ].join('\n');
    const found = sharedReferences(sample);
    assert.equal(found.length, 8);
    assert.deepEqual(found.map(isTypeOnly), [true, false, false, false, false, false, false, false]);
  });

  it('the tsconfig `paths` mapping points at the same file the workspace package exports (redundant, not divergent)', () => {
    const tsconfig = JSON.parse(readFileSync(join(MOBILE, 'tsconfig.json'), 'utf8')) as { compilerOptions?: { paths?: Record<string, string[]> } };
    const mapped = tsconfig.compilerOptions?.paths?.['@fintech-wallet/shared'];
    assert.ok(mapped && mapped.length === 1, 'one explicit mapping');
    const sharedPackage = JSON.parse(readFileSync(join(MOBILE, '..', 'packages', 'shared', 'package.json'), 'utf8')) as { exports?: unknown };
    assert.equal(typeof sharedPackage.exports, 'string', 'shared exports a single entry; if it gains conditions or a dist build, revisit §7');
    assert.equal(resolve(MOBILE, mapped[0]!), resolve(MOBILE, '..', 'packages', 'shared', sharedPackage.exports as string));
  });
});
