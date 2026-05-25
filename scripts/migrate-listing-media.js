/** @deprecated Use: npm run db:sync */
import { spawn } from 'child_process';
console.log('migrate-listing-media.js → npm run db:sync');
const child = spawn(process.execPath, ['scripts/db-sync.js'], { stdio: 'inherit', cwd: process.cwd() });
child.on('exit', (code) => process.exit(code ?? 0));
