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
  'pane_current_path', 'session_attached', 'window_activity', 'pane_start_command', '@cr_term',
];

// Marca (opción de panel de tmux) de las terminales sin Claude abiertas desde «Nueva».
const TERM_MARK = '@cr_term';

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

// Panel lanzado por `ct` o por «Nueva»: «$SHELL -ilc "claude …; exec $SHELL -il"».
const FROM_CT = /;\s*exec \S+ -il"?\s*$/;

// Shell que quedó tras salir Claude. Sin terminal, cualquiera; con terminal abierta, solo los de `ct`/«Nueva»
// (un tmux abierto a mano es alguien trabajando).
function isLeftoverShell(pid, attached, startCommand, kids) {
  return isIdleShell(pid, kids) && (!attached || FROM_CT.test(startCommand || ''));
}

// Estado aproximado leyendo lo que hay en pantalla.
function guessState(screen) {
  if (/Do you want to|Would you like to|❯\s*1\.\s|\(y\/n\)|Enter to confirm/i.test(screen)) return 'waiting';
  // Spinner en la columna 0: «✻ Levitating… (3m 24s · ↓ 16.7k tokens)», y al arrancar solo «* Scurrying…»
  // o «* Scurrying… (running SessionStart hooks…)». Al terminar queda «✻ Baked for 11s» (sin «…»).
  if (/esc to interrupt/i.test(screen) || /^[·✢✳✶✻✽*+]\uFE0F?\s+\S[^\n]*…\s*(\(.*)?$/m.test(screen)) return 'working';
  // Claude terminó su turno pero hay agentes en segundo plano: «✻ Waiting for 1 background agent to finish»
  // o, al pie, filas «◯ general-purpose  Running build   1m 38s · ↓ 91.9k tokens».
  if (/Waiting for \d+ background (agent|task)/i.test(screen) || /^\s*◯ \S.*\d+[smh] · [↓↑] [\d.]+k? tokens\s*$/m.test(screen)) return 'agents';
  return 'idle';
}

// Comando con que se lanzó el panel (`ct`/«Nueva» guardan «$SHELL -ilc "claude-xxx …; exec …"»).
function launchCmd(startCommand) {
  return (startCommand || '').match(/-ilc \\?"?([\w.-]+)/)?.[1] || null;
}

// Cuenta de Claude del panel: la carpeta de config del proceso (CLAUDE_CONFIG_DIR=~/.claude-work → «work»)
// o, si Claude ya salió, el comando con que se lanzó (claude-personal → «personal»). «claude» a secas = cuenta por defecto.
function account(pid, startCommand) {
  let name = null;
  if (pid) {
    try {
      const v = fs.readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0').find((e) => e.startsWith('CLAUDE_CONFIG_DIR='));
      name = v ? path.basename(v.slice('CLAUDE_CONFIG_DIR='.length).replace(/\/+$/, '')).replace(/^\./, '') : 'claude';
    } catch { /* sin permiso o terminó */ }
  }
  name = name || launchCmd(startCommand);
  if (!name) return null;
  return name === 'claude' ? 'default' : name.replace(/^claude-/, '');
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
    const term = !claude && p[TERM_MARK] === '1';
    const ended = !claude && !term && isLeftoverShell(Number(p.pane_pid), Number(p.session_attached) > 0, p.pane_start_command, kids);
    return { ...p, claude, ended, term };
  }).filter((p) => p.claude || p.ended || p.term);

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
      account: p.term ? null : account(p.claude, p.pane_start_command),
      state: p.term ? 'term' : p.ended ? 'ended' : guessState(screen),
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

// Para volver a abrir Claude en un panel donde ya salió: el comando con que se lanzó (`ct`/«Nueva» guardan
// «$SHELL -ilc "claude-xxx …; exec …"», así se respeta el alias y su config) y el ID que Claude imprime al salir
// («claude --resume <id>»). 409 si Claude sigue abierto.
export async function relaunchInfo(pane) {
  const [pidStr, startCommand] = (await tmux(['display-message', '-p', '-t', pane, '#{pane_pid}\t#{pane_start_command}'])).trim().split('\t');
  if (findClaude(Number(pidStr), childrenMap())) throw Object.assign(new Error('Claude sigue abierto en ese panel'), { status: 409 });
  const cmd = launchCmd(startCommand) || 'claude';
  const ids = [...(await history(pane, 500)).matchAll(/--resume\s+([\w-]{8,})/g)];
  return { cmd, resume: ids.length ? ids[ids.length - 1][1] : null };
}

// Cierra el panel de Claude o el shell vacío que quedó al salir (si era el único, tmux borra la sesión). La conversación queda para `--resume`.
// Claude abierto en una terminal no se cierra, para no cortarle la sesión a quien la está usando; el shell que
// dejó `ct` sí (su terminal se cierra con él).
export async function closePane(pane) {
  const [att, pidStr, startCommand, mark] = (await tmux(['display-message', '-p', '-t', pane, `#{session_attached}\t#{pane_pid}\t#{pane_start_command}\t#{${TERM_MARK}}`])).trim().split('\t');
  const attached = Number(att) > 0;
  const pid = Number(pidStr);
  const kids = childrenMap();
  const claude = findClaude(pid, kids);
  if (claude && attached) throw Object.assign(new Error('la sesión está abierta en una terminal'), { status: 409 });
  if (!claude && mark !== '1' && !isLeftoverShell(pid, attached, startCommand, kids)) {
    throw Object.assign(new Error('ese panel no es una sesión de Claude ni un shell que quedó de ct'), { status: 400 });
  }
  await tmux(['kill-pane', '-t', pane]);
}

// Abre una ventana de terminal en la laptop unida a la sesión del panel.
// LAPTOP_TERMINAL es el prefijo del comando (por defecto «gnome-terminal --»); se le agrega «tmux attach …».
export async function openOnLaptop(pane) {
  const mark = (await tmux(['display-message', '-p', '-t', pane, `#{${TERM_MARK}}`])).trim();
  if (mark !== '1' && !(await claudePid(pane))) throw Object.assign(new Error('ese panel no es una sesión de Claude'), { status: 400 });
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
// cmd = null abre solo una terminal (sin Claude), marcada para que aparezca en la lista.
export async function newSession(dir, name, cmd = 'claude') {
  const base = (name || path.basename(dir)).replace(/[^\w.-]/g, '-').slice(0, 40) || 'claude';
  let session = base;
  const existing = new Set((await tmux(['list-sessions', '-F', '#{session_name}']).catch(() => '')).split('\n'));
  for (let i = 2; existing.has(session); i++) session = `${base}-${i}`;
  // Shell de login interactivo para que cargue el PATH/alias del usuario; al salir de claude queda el shell.
  const shell = process.env.SHELL || '/bin/bash';
  // Con nombre, Claude también lo usa (igual que `ct -n`). `session` solo tiene [\w.-], seguro para el shell.
  const claude = name ? `${cmd} --name ${session}` : cmd;
  const start = cmd ? [shell, '-ilc', `${claude}; exec ${shell} -il`] : [shell, '-il'];
  const pane = (await tmux(['new-session', '-d', '-P', '-F', '#{pane_id}', '-s', session, '-c', dir, ...start])).trim();
  if (!cmd) await tmux(['set-option', '-p', '-t', pane, TERM_MARK, '1']);
  return session;
}
