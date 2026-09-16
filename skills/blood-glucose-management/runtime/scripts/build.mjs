import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));
await build({absWorkingDir:root,entryPoints:['src/index.ts','src/cli.ts'],outdir:'dist',bundle:true,platform:'node',target:'node22',format:'esm',packages:'external',sourcemap:true,logLevel:'warning'});
