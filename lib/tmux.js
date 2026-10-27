// Lectura de sesiones tmux y detección de cuáles corren Claude Code.
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';

const run = promisify(execFile);

export const PANE_ID = /^%\d+$/;
export const SESSION_NAME = /^[\w.-]{1,64}$/;

export async function tmux(args) {
  const { stdout } = await run('tmux', args, { timeout: 5000, maxBuffer: 8 * 1024 * 1024 });
  return stdout;
}

const FIELDS = [
  'session_name', 'window_index', 'pane_index', 'pane_id', 'pane_pid',
  'pane_current_path', 'session_attached', 'window_activity',
];

// Hijos de cada proceso, leídos de /proc (Linux).
function childrenMap() {
  const kids = new Map();
  for (const d of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(d)) continue;
    try {
      const stat = fs.readFileSync(`/proc/${d}/stat`, 'utf8');
      const ppid = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]);
      if (!kids.has(ppid)) kids.set(ppid, []);
      kids.get(ppid).push(Number(d));
    } catch { /* el proceso terminó mientras leíamos */ }
  }
  return kids;
}

function comm(pid) {
  try { return fs.readFileSync(`/proc/${pid}/comm`, 'utf8').trim(); } catch { return ''; }
}

// PID del proceso `claude` en el árbol del panel (el shell del panel o sus descendientes), o 0.
function findClaude(rootPid, kids) {
  const queue = [[rootPid, 0]];
  while (queue.length) {
    const [pid, depth] = queue.shift();
    if (comm(pid) === 'claude') return pid;
    if (depth < 4) for (const c of kids.get(pid) || []) queue.push([c, depth + 1]);
  }
  return 0;
}

// Shell sin ningún proceso corriendo: lo que queda de `ct` o de «Nueva» cuando Claude ya salió.
const SHELLS = new Set(['zsh', 'bash', 'sh', 'fish', 'dash']);
function isIdleShell(pid, kids) {
  return SHELLS.has(comm(pid)) && !(kids.get(pid) || []).length;
}

// Estado aproximado leyendo lo que hay en pantalla.
function guessState(screen) {
  if (/Do you want to|Would you like to|❯\s*1\.\s|\(y\/n\)|Enter to confirm/i.test(screen)) return 'waiting';
  // Spinner en la columna 0: «✻ Levitating… (3m 24s · ↓ 16.7k tokens)», y al arrancar solo «* Scurrying…»
  // o «* Scurrying… (running SessionStart hooks…)». Al terminar queda «✻ Baked for 11s» (sin «…»).
  if (/esc to interrupt/i.test(screen) || /^[·✢✳✶✻✽*+]\uFE0F?\s+\S[^\n]*…\s*(\(.*)?$/m.test(screen)) return 'working';
  return 'idle';
}

function lastLines(screen, n) {
  return screen.split('\n').map((l) => l.trimEnd()).filter((l) => l.trim()).slice(-n);
}

export async function listClaudePanes() {
  let out;
  try {
    out = await tmux(['list-panes', '-a', '-F', FIELDS.map((f) => `#{${f}}`).join('\t')]);
  } catch (err) {
    if (err.code === 'ENOENT') throw new Error('tmux no está instalado en la laptop (sudo apt install tmux)');
    // Sin servidor tmux corriendo = sin sesiones.
    if (/no server running|error connecting|No such file/i.test(String(err.stderr || err.message))) return [];
    throw err;
  }
  const kids = childrenMap();
  const panes = out.trim().split('\n').filter(Boolean).map((line) => {
    const v = line.split('\t');
    const p = Object.fromEntries(FIELDS.map((f, i) => [f, v[i]]));
    const claude = findClaude(Number(p.pane_pid), kids);
    // Solo shells sin terminal: uno abierto en una terminal es alguien trabajando a mano.
    const ended = !claude && Number(p.session_attached) === 0 && isIdleShell(Number(p.pane_pid), kids);
    return { ...p, claude, ended };
  }).filter((p) => p.claude || p.ended);

  return Promise.all(panes.map(async (p) => {
    let screen = '';
    try { screen = await tmux(['capture-pane', '-p', '-J', '-t', p.pane_id]); } catch { /* panel cerrado */ }
    return {
      pane: p.pane_id,
      pid: p.claude,
      session: p.session_name,
      target: `${p.session_name}:${p.window_index}.${p.pane_index}`,
      cwd: p.pane_current_path,
      project: path.basename(p.pane_current_path),
      attached: Number(p.session_attached) > 0,
      activity: Number(p.window_activity) * 1000,
      state: p.ended ? 'ended' : guessState(screen),
      preview: lastLines(screen, 4),
    };
  }));
}

export async function paneInfo(pane) {
  const out = await tmux(['display-message', '-p', '-t', pane, '#{session_name}\t#{pane_current_path}']);
  const [session, cwd] = out.trim().split('\t');
  return { session, cwd, project: path.basename(cwd || '') };
}

export async function claudePid(pane) {
  const pid = Number((await tmux(['display-message', '-p', '-t', pane, '#{pane_pid}'])).trim());
  return findClaude(pid, childrenMap());
}

export async function history(pane, lines = 3000) {
  return tmux(['capture-pane', '-p', '-J', '-S', `-${lines}`, '-t', pane]);
}

// Cierra el panel de Claude o el shell vacío que quedó al salir (si era el único, tmux borra la sesión). La conversación queda para `--resume`.
// Solo si nadie lo tiene abierto en una terminal, para no cerrarle la sesión a quien la está usando.
export async function closePane(pane) {
  const attached = Number((await tmux(['display-message', '-p', '-t', pane, '#{session_attached}'])).trim());
  if (attached > 0) throw Object.assign(new Error('la sesión está abierta en una terminal'), { status: 409 });
  const pid = Number((await tmux(['display-message', '-p', '-t', pane, '#{pane_pid}'])).trim());
  const kids = childrenMap();
  if (!findClaude(pid, kids) && !isIdleShell(pid, kids)) {
    throw Object.assign(new Error('ese panel no es una sesión de Claude ni un shell vacío'), { status: 400 });
  }
  await tmux(['kill-pane', '-t', pane]);
}

// Abre una ventana de terminal en la laptop unida a la sesión del panel.
// LAPTOP_TERMINAL es el prefijo del comando (por defecto «gnome-terminal --»); se le agrega «tmux attach …».
export async function openOnLaptop(pane) {
  if (!(await claudePid(pane))) throw Object.assign(new Error('ese panel no es una sesión de Claude'), { status: 400 });
  await tmux(['select-window', '-t', pane, ';', 'select-pane', '-t', pane]);
  const [bin, ...args] = (process.env.LAPTOP_TERMINAL || 'gnome-terminal --').split(/\s+/).filter(Boolean);
  const env = { ...process.env, DISPLAY: process.env.DISPLAY || ':0' };
  delete env.TMUX;
  await new Promise((resolve, reject) => {
    const child = spawn(bin, [...args, 'tmux', 'attach-session', '-t', pane], { env, detached: true, stdio: 'ignore' });
    child.once('error', (err) => reject(Object.assign(new Error(`no se pudo abrir la terminal (${bin}): ${err.message}`), { status: 500 })));
    child.once('spawn', () => { child.unref(); resolve(); });
  });
}

// `cmd` puede ser un alias de tu shell (p. ej. claude-work): se ejecuta en un shell interactivo.
export async function newSession(dir, name, cmd = 'claude') {
  const base = (name || path.basename(dir)).replace(/[^\w.-]/g, '-').slice(0, 40) || 'claude';
  let session = base;
  const existing = new Set((await tmux(['list-sessions', '-F', '#{session_name}']).catch(() => '')).split('\n'));
  for (let i = 2; existing.has(session); i++) session = `${base}-${i}`;
  // Shell de login interactivo para que cargue el PATH/alias del usuario; al salir de claude queda el shell.
  const shell = process.env.SHELL || '/bin/bash';
  await tmux(['new-session', '-d', '-s', session, '-c', dir, shell, '-ilc', `${cmd}; exec ${shell} -il`]);
  return session;
}
