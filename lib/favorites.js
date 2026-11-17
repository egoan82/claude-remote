// Carpetas favoritas para «Nueva sesión». Viven en data/favorites.json, así se comparten
// entre el celular y la laptop.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DATA = path.resolve(process.env.DATA_DIR || new URL('../data', import.meta.url).pathname);
const FILE = path.join(DATA, 'favorites.json');
const MAX = 100;

fs.mkdirSync(DATA, { recursive: true, mode: 0o700 });

let items;
try { items = JSON.parse(fs.readFileSync(FILE, 'utf8')).filter((d) => typeof d === 'string'); } catch { items = []; }
const write = () => fs.writeFileSync(FILE, JSON.stringify(items, null, 2), { mode: 0o600 });
const bad = (msg) => Object.assign(new Error(msg), { status: 400 });
const norm = (dir) => (typeof dir === 'string' ? path.resolve(dir.trim().replace(/^~(?=\/|$)/, os.homedir())) : '');

export const list = () => items;

export function add(dir) {
  dir = norm(dir);
  if (!dir || dir.length > 1024) throw bad('ruta inválida');
  if (!items.includes(dir)) {
    if (items.length >= MAX) throw bad(`máximo ${MAX} favoritos`);
    items.push(dir);
    write();
  }
  return items;
}

export function remove(dir) {
  dir = norm(dir);
  items = items.filter((d) => d !== dir);
  write();
  return items;
}
