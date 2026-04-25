/**
 * Post-build script for the CJS bundle.
 *
 * Runs after `tsc -p tsconfig.cjs.json`.  It:
 *  1. Writes `dist/cjs/package.json` so Node.js treats .js files there as CJS.
 *  2. Creates stub files for modules that use import.meta.url (ESM-only APIs)
 *     and therefore cannot be compiled to CJS by tsc.  These stubs export the
 *     same symbols but throw informative errors if called from CJS code, which
 *     should not happen in practice (the affected exports are CLI / lint helpers
 *     designed to run from the ESM bundle or the aiglue CLI).
 */

'use strict'

const fs = require('fs')
const path = require('path')

const distCjs = path.join(__dirname, '..', 'dist', 'cjs')

// 1. Mark dist/cjs/ as CommonJS so Node.js loads .js files with require().
fs.writeFileSync(
  path.join(distCjs, 'package.json'),
  JSON.stringify({ type: 'commonjs' }, null, 2),
)

// 2. Stubs for ESM-only modules (they use import.meta.url).
const stubs = {
  'validate/lint.js': `'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
/**
 * lintFile is only available in the ESM build of @aiglue/core.
 * If you need it from a CommonJS project, use dynamic import:
 *   const { lintFile } = await import('@aiglue/core');
 */
exports.lintFile = function lintFile() {
  throw new Error(
    '@aiglue/core: lintFile is only available in the ESM build. ' +
    "Use: const { lintFile } = await import('@aiglue/core')"
  );
};
`,
  'cli/init.js': `'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
/**
 * runInit is only available in the ESM build of @aiglue/core.
 */
exports.runInit = function runInit() {
  throw new Error(
    '@aiglue/core: runInit is only available in the ESM build.'
  );
};
`,
}

for (const [rel, content] of Object.entries(stubs)) {
  const filePath = path.join(distCjs, rel)
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content)
  console.log('wrote stub:', filePath)
}
