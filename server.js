// claude-remote: lista las sesiones de Claude Code que corren en tmux y las expone
// como terminal web (PWA). Escucha solo en localhost; `tailscale serve` lo publica
// con HTTPS dentro de tu tailnet.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import pty from 'node-pty';
import * as tmux from './lib/tmux.js';
import * as push from './lib/push.js';
import * as transcript from './lib/transcript.js';
import * as snippets from './lib/snippets.js';

const ROOT = path.dirname(new URL(import.meta.url).pathname);
const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 7681);
const list = (v) => (v || '').split(',').map((s) => s.trim()).filter(Boolean);
// Quién puede entrar por la tailnet: usuarios de Tailscale y/o IPs 100.x de dispositivos.
// Si ambas listas están vacías se rechaza todo acceso por la tailnet, salvo ALLOW_ANY_TAILNET=1.
const ALLOWED_LOGINS = list(process.env.ALLOWED_LOGINS);
const ALLOWED_IPS = list(process.env.ALLOWED_IPS);
const ALLOW_ANY_TAILNET = process.env.ALLOW_ANY_TAILNET === '1';
// Aviso al terminar cada respuesta: apagado por defecto (es demasiado frecuente). NOTIFY_ON_STOP=1 lo activa.
const NOTIFY_ON_STOP = process.env.NOTIFY_ON_STOP === '1';
// Comandos (o alias de tu shell) con los que se puede abrir una sesión nueva; el primero es el de por defecto.
const CLAUDE_CMDS = (process.env.CLAUDE_CMDS || 'claude').split(',').map((s) => s.trim()).filter((s) => /^[\w.-]+$/.test(s));
const PROJECT_ROOTS = (process.env.PROJECT_ROOTS || ['~/projects', '~/code', '~/src'].join(':'))
  .split(':').filter(Boolean).map((p) => p.replace(/^~/, os.homedir()));

// ---------- seguridad ----------
// Solo aceptamos Host/Origin locales o de la tailnet (*.ts.net). Esto bloquea que una
// página cualquiera abierta en el navegador de la laptop use el servidor (CSRF / DNS rebinding).
const okHost = (h) => /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(h || '') || /\.ts\.net(:\d+)?$/.test(h || '');

// Lo que llega por `tailscale serve` trae x-forwarded-for con la IP real del dispositivo (serve la
// reemplaza siempre, no se puede falsificar) y tailscale-user-login (vacío en dispositivos con tag).
// Sin esos encabezados, la petición viene de la propia laptop.
const viaTailnet = (req) => Boolean(req.headers['x-forwarded-for'] || req.headers['tailscale-user-login']);
const clientIp = (req) => String(req.headers['x-forwarded-for'] || '').split(',').pop().trim();

function allowed(req) {
  if (!okHost(req.headers.host)) return false;
  const origin = req.headers.origin;
  if (origin) { try { if (!okHost(new URL(origin).host)) return false; } catch { return false; } }
  if (viaTailnet(req)) {
    const login = req.headers['tailscale-user-login'] || '';
    const ip = clientIp(req);
    if (!ALLOWED_LOGINS.length && !ALLOWED_IPS.length && !ALLOW_ANY_TAILNET) return deny(req, 'sin ALLOWED_LOGINS/ALLOWED_IPS configurados');
    if (ALLOWED_LOGINS.length && !ALLOWED_LOGINS.includes(login)) return deny(req, `usuario «${login || 'sin usuario'}»`);
    if (ALLOWED_IPS.length && !ALLOWED_IPS.includes(ip)) return deny(req, `dispositivo ${ip || 'desconocido'}`);
  }
  return true;
}

function deny(req, why) {
  console.warn(`acceso rechazado (${why}): ${req.method} ${req.url.split('?')[0]}`);
  return false;
}

const isLocalCall = (req) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)
  && !req.headers.origin && !viaTailnet(req);

// ---------- utilidades HTTP ----------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json',
};
const STATIC = {
  '/vendor/xterm.js': 'node_modules/@xterm/xterm/lib/xterm.js',
  '/vendor/xterm.css': 'node_modules/@xterm/xterm/css/xterm.css',
  '/vendor/addon-fit.js': 'node_modules/@xterm/addon-fit/lib/addon-fit.js',
};

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
}

function serveFile(res, file) {
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, { error: 'no encontrado' });
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(buf);
  });
}

function readJson(req, limit = 256 * 1024) {
  return new Promise((resolve, reject) => {
    if (!/application\/json/.test(req.headers['content-type'] || '')) return reject(Object.assign(new Error('se espera JSON'), { status: 415 }));
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(Object.assign(new Error('muy grande'), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}')); } catch { reject(Object.assign(new Error('JSON inválido'), { status: 400 })); } });
    req.on('error', reject);
  });
}

function listProjects() {
  const seen = new Set(); const out = [];
  for (const root of PROJECT_ROOTS) {
    let entries = [];
    try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const full = path.join(root, e.name);
      if (!e.isDirectory() || e.name.startsWith('.') || seen.has(full)) continue;
      if (!fs.existsSync(path.join(full, '.git'))) continue;
      seen.add(full); out.push({ name: e.name, dir: full });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

// Imágenes subidas desde el celular: se guardan en /tmp y Claude las lee por su ruta.
const UPLOAD_DIR = path.join(os.tmpdir(), 'claude-remote-uploads');
const IMAGE_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };

function saveImage(req, limit = 20 * 1024 * 1024) {
  const ext = IMAGE_EXT[(req.headers['content-type'] || '').split(';')[0]];
  if (!ext) return Promise.reject(Object.assign(new Error('formato no soportado (png, jpg, gif, webp)'), { status: 415 }));
  fs.mkdirSync(UPLOAD_DIR, { recursive: true, mode: 0o700 });
  // Borra las de más de un día.
  for (const f of fs.readdirSync(UPLOAD_DIR)) {
    const full = path.join(UPLOAD_DIR, f);
    try { if (Date.now() - fs.statSync(full).mtimeMs > 86400e3) fs.unlinkSync(full); } catch { /* ya no está */ }
  }
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(Object.assign(new Error('imagen muy grande'), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      if (!size) return reject(Object.assign(new Error('imagen vacía'), { status: 400 }));
      const file = path.join(UPLOAD_DIR, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`);
      fs.writeFile(file, Buffer.concat(chunks), { mode: 0o600 }, (err) => (err ? reject(err) : resolve(file)));
    });
    req.on('error', reject);
  });
}

// Textos de aviso de Claude Code (vienen en inglés) traducidos para el push.
function translate(msg) {
  if (!msg) return 'Claude necesita tu atención';
  const perm = msg.match(/needs your permission to use (.+)$/i);
  if (perm) return `Claude necesita permiso para usar ${perm[1]}`;
  if (/needs your (attention|approval)/i.test(msg)) return 'Claude necesita tu atención';
  if (/waiting for your input/i.test(msg)) return 'Claude espera tu respuesta';
  return msg;
}

// Paneles abiertos ahora mismo desde la PWA (para no mandar push de lo que ya estás viendo).
const watching = new Map();

// ---------- rutas ----------
async function route(req, res) {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;

  // Hooks de Claude Code: solo desde la propia máquina, sin Origin (curl).
  if (p === '/api/hook' && req.method === 'POST') {
    if (!isLocalCall(req)) return send(res, 403, { error: 'solo local' });
    const ev = await readJson(req);
    const pane = String(req.headers['x-tmux-pane'] || '');
    let info = { project: path.basename(ev.cwd || '') || 'claude', session: '' };
    if (tmux.PANE_ID.test(pane)) info = await tmux.paneInfo(pane).catch(() => info);
    const event = ev.hook_event_name;
    // «Claude is waiting for your input» (idle_prompt) es el mismo caso que Stop: terminó y espera.
    const idle = event === 'Stop' || ev.notification_type === 'idle_prompt' || /waiting for your input/i.test(ev.message || '');
    if (idle && !NOTIFY_ON_STOP) return send(res, 200, { ok: true, skipped: 'espera' });
    if (watching.get(pane) > 0) return send(res, 200, { ok: true, skipped: 'viendo' });
    if (event === 'Notification' || event === 'Stop') {
      await push.notify({
        title: `${idle ? '✅' : '⏳'} ${info.project}`,
        body: idle ? 'Terminó y espera tu siguiente mensaje' : translate(ev.message),
        pane: tmux.PANE_ID.test(pane) ? pane : null,
        tag: pane || info.project,
      });
    }
    return send(res, 200, { ok: true });
  }

  if (!allowed(req)) return send(res, 403, { error: 'prohibido' });

  if (p === '/api/sessions' && req.method === 'GET') {
    const panes = await tmux.listClaudePanes();
    return send(res, 200, panes.map(({ pid, ...s }) => ({ ...s, title: transcript.title(pid) })));
  }

  if (p === '/api/sessions' && req.method === 'POST') {
    const { dir, name, cmd = CLAUDE_CMDS[0], terminal = false } = await readJson(req);
    if (!terminal && !CLAUDE_CMDS.includes(cmd)) return send(res, 400, { error: 'comando no permitido' });
    const real = fs.realpathSync(String(dir || '').replace(/^~/, os.homedir()));
    if (!fs.statSync(real).isDirectory()) return send(res, 400, { error: 'no es una carpeta' });
    if (name && !tmux.SESSION_NAME.test(name)) return send(res, 400, { error: 'nombre inválido' });
    const session = await tmux.newSession(real, name, terminal ? null : cmd);
    return send(res, 201, { session });
  }

  const del = p.match(/^\/api\/panes\/(%25\d+|%\d+)$/);
  if (del && req.method === 'DELETE') {
    await tmux.closePane(decodeURIComponent(del[1]));
    return send(res, 200, { ok: true });
  }

  const open = p.match(/^\/api\/panes\/(%25\d+|%\d+)\/open$/);
  if (open && req.method === 'POST') {
    await tmux.openOnLaptop(decodeURIComponent(open[1]));
    return send(res, 200, { ok: true });
  }

  const hist = p.match(/^\/api\/panes\/(%25\d+|%\d+)\/history$/);
  if (hist && req.method === 'GET') {
    const pane = decodeURIComponent(hist[1]);
    // Claude Code usa la pantalla alterna: tmux no guarda scrollback, así que se lee su transcripción.
    const pid = await tmux.claudePid(pane).catch(() => 0);
    if (url.searchParams.get('format') === 'json') {
      const messages = transcript.messages(pid);
      return send(res, 200, messages ? { messages } : { text: await tmux.history(pane) });
    }
    const text = transcript.render(pid) ?? await tmux.history(pane);
    return send(res, 200, text, 'text/plain; charset=utf-8');
  }

  if (p === '/api/upload' && req.method === 'POST') return send(res, 201, { path: await saveImage(req) });

  // Comandos guardados para insertar en el cuadro de texto.
  if (p === '/api/snippets' && req.method === 'GET') return send(res, 200, snippets.list());
  if (p === '/api/snippets' && req.method === 'POST') return send(res, 201, snippets.save(await readJson(req)));
  const snip = p.match(/^\/api\/snippets\/([\w-]{1,40})$/);
  if (snip && req.method === 'DELETE') { snippets.remove(snip[1]); return send(res, 200, { ok: true }); }

  if (p === '/api/projects') return send(res, 200, listProjects());
  if (p === '/api/commands') return send(res, 200, CLAUDE_CMDS);
  if (p === '/api/push/key') return send(res, 200, { key: push.publicKey });
  if (p === '/api/push/subscribe' && req.method === 'POST') { push.subscribe(await readJson(req)); return send(res, 201, { ok: true }); }
  if (p === '/api/push/test' && req.method === 'POST') {
    const n = await push.notify({ title: '🔔 claude-remote', body: 'Las notificaciones funcionan', tag: 'test' });
    return send(res, 200, { sent: n });
  }

  if (STATIC[p]) return serveFile(res, path.join(ROOT, STATIC[p]));
  const file = path.join(ROOT, 'public', p === '/' ? 'index.html' : path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(path.join(ROOT, 'public'))) return send(res, 404, { error: 'no encontrado' });
  return serveFile(res, file);
}

const server = http.createServer((req, res) => {
  route(req, res).catch((err) => {
    console.error(req.method, req.url, err.message);
    if (!res.headersSent) send(res, err.status || 500, { error: err.message });
  });
});

// ---------- terminal por WebSocket ----------
// Cliente -> servidor: JSON {t:'i', d:'texto'} | {t:'r', c:cols, r:rows}. Servidor -> cliente: texto crudo.
const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://x');
  const pane = url.searchParams.get('pane') || '';
  if (url.pathname !== '/ws' || !allowed(req) || !tmux.PANE_ID.test(pane)) { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, (ws) => attach(ws, pane, url.searchParams));
});

function attach(ws, pane, params) {
  const cols = Math.min(Math.max(Number(params.get('cols')) || 80, 20), 400);
  const rows = Math.min(Math.max(Number(params.get('rows')) || 24, 5), 200);
  const env = { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor', LANG: process.env.LANG || 'C.UTF-8' };
  delete env.TMUX;
  // Enfoca la ventana/panel de Claude y se une a su sesión.
  const term = pty.spawn('tmux', ['select-window', '-t', pane, ';', 'select-pane', '-t', pane, ';', 'attach-session', '-t', pane],
    { name: 'xterm-256color', cols, rows, cwd: os.homedir(), env });

  watching.set(pane, (watching.get(pane) || 0) + 1);
  term.onData((d) => { if (ws.readyState === ws.OPEN) ws.send(d); });
  term.onExit(() => ws.close(1000, 'fin'));
  ws.on('message', (raw) => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (m.t === 'i' && typeof m.d === 'string') term.write(m.d);
    else if (m.t === 'r') term.resize(Math.min(Math.max(m.c | 0, 20), 400), Math.min(Math.max(m.r | 0, 5), 200));
  });
  ws.on('close', () => {
    watching.set(pane, Math.max((watching.get(pane) || 1) - 1, 0));
    try { term.kill(); } catch { /* ya terminó */ }
  });
}

server.listen(PORT, HOST, () => console.log(`claude-remote escuchando en http://${HOST}:${PORT}`));
