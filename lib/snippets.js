// Comandos guardados desde la app (se insertan en el cuadro de texto). Viven en data/snippets.json,
// así se comparten entre el celular y la laptop.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const DATA = path.resolve(process.env.DATA_DIR || new URL('../data', import.meta.url).pathname);
const FILE = path.join(DATA, 'snippets.json');
const MAX = 200;

fs.mkdirSync(DATA, { recursive: true, mode: 0o700 });

let items;
try { items = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { items = []; }
const write = () => fs.writeFileSync(FILE, JSON.stringify(items, null, 2), { mode: 0o600 });
const bad = (msg) => Object.assign(new Error(msg), { status: 400 });

export const list = () => items;

// Crea uno nuevo o, si trae un id existente, lo reemplaza.
export function save({ id, name, text } = {}) {
  text = typeof text === 'string' ? text.replace(/\s+$/, '') : '';
  name = typeof name === 'string' ? name.trim() : '';
  if (!text.trim()) throw bad('el comando está vacío');
  if (text.length > 4000 || name.length > 60) throw bad('muy largo');
  const old = items.find((s) => s.id === id);
  if (old) Object.assign(old, { name, text });
  else {
    if (items.length >= MAX) throw bad(`máximo ${MAX} comandos`);
    items.push({ id: crypto.randomUUID().slice(0, 8), name, text });
  }
  write();
  return old || items[items.length - 1];
}

export function remove(id) {
  items = items.filter((s) => s.id !== id);
  write();
}
