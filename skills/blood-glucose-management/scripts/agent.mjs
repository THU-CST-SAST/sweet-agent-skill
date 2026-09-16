#!/usr/bin/env node
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const root=fileURLToPath(new URL('../runtime/',import.meta.url));
const cli=fileURLToPath(new URL('../runtime/dist/cli.js',import.meta.url));
if(!existsSync(cli)){
  console.error('Runtime is not built. In the skill runtime directory run: npm ci && npm run build');
  process.exit(1);
}
const child=spawnSync(process.execPath,[cli,...process.argv.slice(2)],{cwd:root,stdio:'inherit',env:process.env});
if(child.error)console.error(child.error.message);
process.exit(child.status??1);
