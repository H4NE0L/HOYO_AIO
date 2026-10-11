import { readdir, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
async function check(dir) {
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const path = `${dir}/${item.name}`;
    if (item.isDirectory()) await check(path);
    else if (path.endsWith('.js') || path.endsWith('.mjs')) execFileSync(process.execPath, ['--check', path], { stdio: 'inherit' });
  }
}
await check('extension');
const manifest = JSON.parse(await readFile('extension/manifest.json', 'utf8'));
for (const path of [manifest.background.service_worker, manifest.action.default_popup, 'dashboard.html']) await readFile(`extension/${path}`);
console.log('PASS: all extension JavaScript syntax and manifest entry files.');
