// Agrega los hooks Notification y Stop de claude-remote a uno o varios settings.json de Claude Code.
// Uso: node scripts/install-hooks.js ~/.claude [~/.claude-work ...]
// Es idempotente y guarda un respaldo settings.json.bak-claude-remote antes de escribir.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HOOK = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'hooks', 'notify.sh');
const dirs = process.argv.slice(2).map((d) => d.replace(/^~/, os.homedir()));
if (!dirs.length) { console.error('Uso: node scripts/install-hooks.js <dir-config-claude> [...]'); process.exit(1); }

for (const dir of dirs) {
  const file = path.join(dir, 'settings.json');
  let settings = {};
  if (fs.existsSync(file)) {
    settings = JSON.parse(fs.readFileSync(file, 'utf8'));
    fs.copyFileSync(file, `${file}.bak-claude-remote`);
  }
  settings.hooks ??= {};
  for (const event of ['Notification', 'Stop']) {
    const groups = (settings.hooks[event] ??= []);
    const present = groups.some((g) => g.hooks?.some((h) => h.command === HOOK));
    if (!present) groups.push({ hooks: [{ type: 'command', command: HOOK, timeout: 5 }] });
  }
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`);
  console.log(`hooks listos en ${file}`);
}
