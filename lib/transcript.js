// Historial de una sesión de Claude Code leído de su transcripción (.jsonl), no de la pantalla.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const MAX_BYTES = 8 * 1024 * 1024;   // de archivos enormes solo se lee el final
const TOOL_LINE = 160;

// Carpeta de config del proceso (CLAUDE_CONFIG_DIR, p. ej. ~/.claude-work) o ~/.claude.
function configDir(pid) {
  try {
    const env = fs.readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0');
    const v = env.find((e) => e.startsWith('CLAUDE_CONFIG_DIR='));
    if (v) return v.slice('CLAUDE_CONFIG_DIR='.length);
  } catch { /* sin permiso o terminó */ }
  return path.join(os.homedir(), '.claude');
}

function transcriptPath(pid) {
  const dir = configDir(pid);
  let meta;
  try { meta = JSON.parse(fs.readFileSync(path.join(dir, 'sessions', `${pid}.json`), 'utf8')); } catch { return null; }
  if (!/^[\w-]+$/.test(meta.sessionId || '')) return null;
  const file = `${meta.sessionId}.jsonl`;
  const guess = path.join(dir, 'projects', String(meta.cwd || '').replace(/[^A-Za-z0-9]/g, '-'), file);
  if (fs.existsSync(guess)) return guess;
  try {
    for (const d of fs.readdirSync(path.join(dir, 'projects'))) {
      const f = path.join(dir, 'projects', d, file);
      if (fs.existsSync(f)) return f;
    }
  } catch { /* sin carpeta projects */ }
  return null;
}

function readTail(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - MAX_BYTES);
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    const text = buf.toString('utf8');
    return start ? text.slice(text.indexOf('\n') + 1) : text;   // descarta la línea cortada
  } finally { fs.closeSync(fd); }
}

function userText(content) {
  if (typeof content !== 'string') return content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  const cmd = content.match(/<command-name>([^<]*)<\/command-name>[\s\S]*?(?:<command-args>([^<]*)<\/command-args>)?/);
  if (cmd) return `${cmd[1]} ${cmd[2] || ''}`.trim();
  if (/^\s*<(local-command|system-reminder|bash-|task-notification)/.test(content)) return '';
  return content;
}

function toolLine(b) {
  const i = b.input || {};
  const arg = i.command ?? i.file_path ?? i.pattern ?? i.description ?? i.url ?? i.query ?? '';
  const line = `  ⚙ ${b.name}${arg ? `: ${String(arg).replace(/\s+/g, ' ')}` : ''}`;
  return line.length > TOOL_LINE ? `${line.slice(0, TOOL_LINE - 1)}…` : line;
}

// Nombre puesto con /rename (última línea "custom-title"), o ''.
// El listado lo pide en cada refresco: se cachea y solo se lee lo nuevo del archivo.
const titles = new Map();   // archivo → { offset, title }
export function title(pid) {
  const file = pid && transcriptPath(pid);
  if (!file) return '';
  const c = titles.get(file) || { offset: 0, title: '' };
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const size = fs.fstatSync(fd).size;
      if (size < c.offset) Object.assign(c, { offset: 0, title: '' });
      if (size > c.offset) {
        const buf = Buffer.alloc(size - c.offset);
        fs.readSync(fd, buf, 0, buf.length, c.offset);
        const end = buf.lastIndexOf(10) + 1;   // hasta la última línea completa
        for (const line of buf.subarray(0, end).toString('utf8').split('\n')) {
          if (!line.includes('"custom-title"')) continue;
          try { const o = JSON.parse(line); if (o.type === 'custom-title') c.title = o.customTitle || ''; } catch { /* línea rota */ }
        }
        c.offset += end;
      }
    } finally { fs.closeSync(fd); }
  } catch { return c.title; }
  titles.set(file, c);
  return c.title;
}

// Texto legible de la conversación, o null si no se encuentra la transcripción.
export function render(pid) {
  if (!pid) return null;
  const file = transcriptPath(pid);
  if (!file) return null;
  const out = [];
  for (const line of readTail(file).split('\n')) {
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    if (o.isSidechain || o.isMeta || !o.message) continue;
    if (o.type === 'user') {
      const t = userText(o.message.content).trim();
      if (t) out.push(`\n━━━ Tú ━━━\n${t}`);
    } else if (o.type === 'assistant' && Array.isArray(o.message.content)) {
      for (const b of o.message.content) {
        if (b.type === 'text' && b.text.trim()) out.push(`\n● ${b.text.trim()}`);
        else if (b.type === 'tool_use') out.push(toolLine(b));
      }
    }
  }
  return out.length ? out.join('\n').trimStart() : null;
}

// La conversación como lista de mensajes para mostrarla como chat:
// { role: 'user' | 'assistant', text, ts } y { role: 'tools', ts, tools: [{ name, arg }] }
// (las herramientas seguidas de un mismo turno van juntas). ts es ISO o undefined.
export function parseMessages(text) {
  const out = [];
  for (const line of text.split('\n')) {
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    if (o.isSidechain || o.isMeta || !o.message) continue;
    const ts = typeof o.timestamp === 'string' ? o.timestamp : undefined;
    if (o.type === 'user') {
      const t = userText(o.message.content).trim();
      if (t) out.push({ role: 'user', text: t, ts });
    } else if (o.type === 'assistant' && Array.isArray(o.message.content)) {
      for (const b of o.message.content) {
        if (b.type === 'text' && b.text.trim()) out.push({ role: 'assistant', text: b.text.trim(), ts });
        else if (b.type === 'tool_use') {
          const i = b.input || {};
          let arg = String(i.command ?? i.file_path ?? i.pattern ?? i.description ?? i.url ?? i.query ?? '').replace(/\s+/g, ' ');
          if (arg.length > TOOL_LINE) arg = `${arg.slice(0, TOOL_LINE - 1)}…`;
          const last = out[out.length - 1];
          if (last?.role === 'tools') last.tools.push({ name: String(b.name), arg });
          else out.push({ role: 'tools', ts, tools: [{ name: String(b.name), arg }] });
        }
      }
    }
  }
  return out;
}

// Igual que render() pero estructurado; null si no se encuentra la transcripción.
export function messages(pid) {
  if (!pid) return null;
  const file = transcriptPath(pid);
  if (!file) return null;
  const list = parseMessages(readTail(file));
  return list.length ? list : null;
}
