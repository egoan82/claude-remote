/* global Terminal, FitAddon */
const $ = (s) => document.querySelector(s);
const api = async (url, opts = {}) => {
  const res = await fetch(url, { ...opts, headers: { 'content-type': 'application/json', ...(opts.headers || {}) } });
  if (!res.ok) throw Object.assign(new Error((await res.json().catch(() => ({}))).error || res.statusText), { status: res.status });
  return res.headers.get('content-type')?.includes('json') ? res.json() : res.text();
};
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const STATE = { waiting: 'Espera respuesta', working: 'Trabajando', idle: 'Libre' };
// Iconos (trazos estilo Lucide) para las plantillas de abajo.
const ICON = {
  folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  term: '<path d="m4 17 6-6-6-6"/><path d="M12 19h8"/>',
  monitor: '<rect width="20" height="14" x="2" y="3" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/>',
  waiting: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/>',
  working: '<path d="M21 12a9 9 0 1 1-6.219-8.56"/>',
  idle: '<path d="M20 6 9 17l-5-5"/>',
  file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
  gear: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  bot: '<path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/>',
  sparkle: '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  empty: '<path d="m7 11 2-2-2-2"/><path d="M11 13h4"/><rect width="18" height="18" x="3" y="3" rx="2"/>',
};
const icon = (n, c = 'i') => `<svg class="${c}" viewBox="0 0 24 24" aria-hidden="true">${ICON[n]}</svg>`;
const store = { get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };

// Explica en claro por qué falló la lista (fetch solo dice «Failed to fetch» / «Load failed»).
function connError(err) {
  if (navigator.onLine === false) return 'Tu celular no tiene internet. Reintentando…';
  if (!err.status) return 'No hay conexión con la laptop: revisa que esté encendida y que Tailscale esté activo. Reintentando…';
  if (err.status >= 502 && err.status <= 504) return 'La laptop responde, pero el servicio claude-remote no. En la laptop: systemctl --user restart claude-remote';
  if (err.status === 403) return 'Este dispositivo no tiene permiso (revisa ALLOWED_LOGINS / ALLOWED_IPS en el servicio).';
  return `Error del servidor: ${err.message}`;
}

// ---------------- lista ----------------
let pollTimer = null;
let lastSessions = [];

async function refresh() {
  try {
    const list = await api('/api/sessions');
    lastSessions = list;
    $('#status').textContent = '';
    list.sort((a, b) => (a.state === 'waiting' ? -1 : 0) - (b.state === 'waiting' ? -1 : 0) || b.activity - a.activity);
    $('#sessions').innerHTML = list.length ? list.map((s) => `
      <li class="card ${s.state}${s.attached ? '' : ' orphan'}"data-pane="${esc(s.pane)}">
        <div class="top">${icon('folder', 'i pico')}<span class="name">${esc(s.title || s.project)}</span><span class="badge ${s.state}">${icon(s.state)}${STATE[s.state]}</span></div>
        <div class="meta"><span class="tgt">${icon('term')}${esc(s.target)}</span><span class="cwd">${esc(s.cwd)}</span>${s.attached ? `<span class="att" title="Abierta en otra terminal">${icon('monitor')}abierta en otra terminal</span>` : ''}</div>
        <pre>${esc(s.preview.join('\n'))}</pre>
        ${s.attached ? '' : `<div class="orphan">${icon('waiting')}<span>Ninguna terminal la tiene abierta; sigue en segundo plano.</span><div class="acts"><button class="open-laptop" type="button">${icon('monitor')}Abrir en la laptop</button><button class="close-pane" type="button">Cerrar</button></div></div>`}
      </li>`).join('') : `
      <li class="empty">${icon('empty', 'i big')}<strong>No hay sesiones de Claude en tmux</strong><span>Crea una con “Nueva” o lanza <code>ct</code> en la laptop.</span></li>`;
    const waiting = list.filter((s) => s.state === 'waiting').length;
    document.title = waiting ? `(${waiting}) Claude Remote` : 'Claude Remote';
  } catch (err) {
    $('#status').textContent = connError(err);
  }
}

function showList() {
  closeTerm();
  $('#term-view').classList.add('hidden');
  $('#list-view').classList.remove('hidden');
  refresh();
  clearInterval(pollTimer);
  pollTimer = setInterval(() => { if (!document.hidden) refresh(); }, 3000);
}

$('#sessions').addEventListener('click', async (e) => {
  const card = e.target.closest('.card');
  if (!card) return;
  const pane = encodeURIComponent(card.dataset.pane);
  if (e.target.closest('.open-laptop')) {
    try { await api(`/api/panes/${pane}/open`, { method: 'POST' }); } catch (err) { $('#status').textContent = `No se pudo abrir en la laptop: ${err.message}`; }
    return refresh();
  }
  if (!e.target.closest('.close-pane')) return openPane(card.dataset.pane, true);
  const s = lastSessions.find((x) => x.pane === card.dataset.pane);
  const aviso = s?.state === 'working' ? '\n\nOjo: está trabajando y se cortará lo que esté haciendo.' : '';
  if (!confirm(`¿Cerrar la sesión ${s?.target || ''}?\nLa conversación queda guardada (ct -- --resume).${aviso}`)) return;
  try { await api(`/api/panes/${encodeURIComponent(card.dataset.pane)}`, { method: 'DELETE' }); } catch (err) { $('#status').textContent = `No se pudo cerrar: ${err.message}`; }
  refresh();
});

// ---------------- terminal ----------------
let term, fit, ws, currentPane = null, retry = null;

function ensureTerm() {
  if (term) return;
  term = new Terminal({
    fontSize: Number(store.get('fontSize', 12)), fontFamily: 'ui-monospace, "JetBrains Mono", Menlo, monospace',
    cursorBlink: true, scrollback: 2000, allowProposedApi: true,
    theme: { background: '#0a0a0a', foreground: '#f2efe9', cursor: '#ff7a45', cursorAccent: '#0a0a0a', selectionBackground: '#5a3322' },
  });
  fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open($('#term'));
  term.onData((d) => sendInput(d));
  new ResizeObserver(() => fitAndResize()).observe($('#term'));
}

function fitAndResize() {
  if (!term || $('#term-view').classList.contains('hidden')) return;
  try { fit.fit(); } catch { return; }
  if (ws?.readyState === 1) ws.send(JSON.stringify({ t: 'r', c: term.cols, r: term.rows }));
}

function sendInput(d) { if (ws?.readyState === 1) ws.send(JSON.stringify({ t: 'i', d })); }

function connect() {
  clearTimeout(retry);
  const pane = currentPane;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws?pane=${encodeURIComponent(pane)}&cols=${term.cols}&rows=${term.rows}`);
  const sock = ws;
  sock.onopen = () => { $('#conn').className = 'dot on'; term.reset(); fitAndResize(); };
  sock.onmessage = (e) => term.write(e.data);
  sock.onclose = () => {
    $('#conn').className = 'dot off';
    // Reintenta mientras sigamos viendo este panel.
    if (sock === ws && currentPane === pane && !document.hidden) retry = setTimeout(connect, 1500);
  };
}

function openPane(pane, push) {
  currentPane = pane;
  clearInterval(pollTimer);
  const s = lastSessions.find((x) => x.pane === pane);
  $('#term-title').textContent = s ? `${s.title || s.project} · ${s.session}` : pane;
  $('#list-view').classList.add('hidden');
  $('#term-view').classList.remove('hidden');
  if (push) history.pushState({ pane }, '', `?pane=${encodeURIComponent(pane)}`);
  ensureTerm();
  requestAnimationFrame(() => { fitAndResize(); connect(); });
}

function closeTerm() {
  currentPane = null;
  clearTimeout(retry);
  if (ws) { const s = ws; ws = null; s.close(); }
}

$('#btn-back').addEventListener('click', () => (history.state?.pane ? history.back() : (history.replaceState(null, '', '/'), showList())));
window.addEventListener('popstate', (e) => (e.state?.pane ? openPane(e.state.pane, false) : showList()));

document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  if (currentPane && (!ws || ws.readyState > 1)) connect();
  else if (!currentPane) refresh();
});

// Teclas rápidas. pointerdown + preventDefault evita que se cierre el teclado del celular.
const KEYS = { 1: '1', 2: '2', 3: '3', esc: '\x1b', tab: '\t', stab: '\x1b[Z', up: '\x1b[A', down: '\x1b[B', enter: '\r', ctrlc: '\x03' };
$('#keys').addEventListener('pointerdown', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  e.preventDefault();
  if (b.dataset.k in KEYS) sendInput(KEYS[b.dataset.k]);
  if (b.dataset.k === 'font+' || b.dataset.k === 'font-') {
    const size = Math.min(Math.max(term.options.fontSize + (b.dataset.k === 'font+' ? 1 : -1), 8), 20);
    term.options.fontSize = size; store.set('fontSize', size); fitAndResize();
  }
});
$('#keys').insertAdjacentHTML('beforeend', '<button data-k="font-" aria-label="Letra más pequeña" title="Letra más pequeña">A−</button><button data-k="font+" aria-label="Letra más grande" title="Letra más grande">A+</button>');

// Prompt: se manda como "pegado" (bracketed paste) para que los saltos de línea no envíen antes de tiempo.
$('#prompt').addEventListener('submit', (e) => {
  e.preventDefault();
  const ta = $('#prompt-text');
  const text = ta.value;
  if (!text.trim()) { sendInput('\r'); return; }
  sendInput(text.includes('\n') ? `\x1b[200~${text}\x1b[201~` : text);
  setTimeout(() => sendInput('\r'), 120);
  ta.value = ''; ta.style.height = '';
});
$('#prompt-text').addEventListener('input', (e) => { const t = e.target; t.style.height = ''; t.style.height = `${t.scrollHeight}px`; });
$('#prompt-text').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); $('#prompt').requestSubmit(); }
});

// Imagen: se sube a la laptop y su ruta se pega en Claude, que la adjunta como [Image #N].
// Las fotos grandes se achican antes (menos datos y Claude no necesita más de ~2000 px).
const MAX_SIDE = 2000;
async function shrink(file) {
  if (file.type === 'image/gif') return file;
  let bmp;
  try { bmp = await createImageBitmap(file); } catch { return file; }
  const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  if (scale === 1 && file.size < 1.5e6 && IMAGE_TYPES.includes(file.type)) return file;
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85));
}
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

$('#btn-image').addEventListener('click', () => $('#image-file').click());
$('#image-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const btn = $('#btn-image');
  btn.disabled = true; btn.classList.add('busy');
  try {
    const blob = await shrink(file);
    const { path } = await api('/api/upload', { method: 'POST', body: blob, headers: { 'content-type': blob.type } });
    sendInput(`\x1b[200~${path} \x1b[201~`);
  } catch (err) {
    alert(`No se pudo subir la imagen: ${err.message}`);
  } finally { btn.disabled = false; btn.classList.remove('busy'); }
});

// Historial completo del panel como chat (más cómodo para leer en el celular que la terminal).
// La transcripción es contenido ajeno: todo se escapa antes de darle formato.
const inline = (t) => esc(t).split(/(`[^`\n]+`)/).map((part, i) => (i % 2
  ? `<code>${part.slice(1, -1)}</code>`
  : part.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*([^*\s][^*\n]*?)\*(?!\w)/g, '$1<em>$2</em>')
    .replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, '<span class="lnk" title="$2">$1</span>'))).join('');

function md(text) {
  const out = [];
  const parts = text.split(/^```[^\n]*\n?/m);
  parts.forEach((chunk, n) => {
    if (n % 2) { out.push(`<pre class="code"><code>${esc(chunk.replace(/\n$/, ''))}</code></pre>`); return; }
    let para = [], list = null, table = [];
    const flush = () => {
      if (para.length) out.push(`<p>${para.map(inline).join('<br>')}</p>`);
      if (list) out.push(`<${list.tag}>${list.items.map((x) => `<li>${inline(x)}</li>`).join('')}</${list.tag}>`);
      if (table.length) out.push(`<pre class="tbl">${esc(table.join('\n'))}</pre>`);
      para = []; list = null; table = [];
    };
    for (const line of chunk.split('\n')) {
      let m;
      if (/^\s*\|/.test(line)) { if (!table.length) flush(); table.push(line.trim()); continue; }
      if (table.length) flush();
      if (!line.trim()) { flush(); continue; }
      if ((m = line.match(/^#{1,6}\s+(.*)/))) { flush(); out.push(`<h4>${inline(m[1])}</h4>`); continue; }
      if ((m = line.match(/^\s*(?:([-*+])|(\d+)[.)])\s+(.*)/))) {
        const tag = m[1] ? 'ul' : 'ol';
        if (para.length || list?.tag !== tag) flush();
        list = list || { tag, items: [] };
        list.items.push(m[3]);
        continue;
      }
      if (list && /^\s{2,}\S/.test(line)) { list.items[list.items.length - 1] += ` ${line.trim()}`; continue; }
      if (list) flush();
      para.push(line);
    }
    flush();
  });
  return out.join('');
}

const toolIcon = (name) => (/^(Bash|BashOutput|KillShell|KillBash)$/.test(name) ? 'term'
  : /^(Read|Edit|MultiEdit|Write|NotebookEdit|NotebookRead)$/.test(name) ? 'file'
    : /^(Grep|Glob|LS|ToolSearch)$/.test(name) ? 'search'
      : /^Web/.test(name) ? 'globe'
        : /^(Task|Agent)$/.test(name) ? 'bot' : 'gear');
const toolRow = (t) => `<div class="trow">${icon(toolIcon(t.name))}<b>${esc(t.name)}</b><span>${esc(t.arg)}</span></div>`;
const hhmm = (d) => d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
const dayName = (d) => {
  const diff = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(d).setHours(0, 0, 0, 0)) / 864e5);
  return diff === 0 ? 'Hoy' : diff === 1 ? 'Ayer' : d.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' });
};

function renderMsg(m, prevDay) {
  const d = m.ts ? new Date(m.ts) : null;
  const day = d && !isNaN(d) ? d.toDateString() : prevDay;
  const sep = day && day !== prevDay ? `<div class="day"><span>${esc(dayName(d))}</span></div>` : '';
  const time = d && !isNaN(d) ? `<time>${hhmm(d)}</time>` : '';
  if (m.role === 'user') return [`${sep}<div class="msg user"><div class="bubble">${esc(m.text)}</div>${time}</div>`, day];
  if (m.role === 'assistant') return [`${sep}<div class="msg claude">${icon('sparkle', 'i avatar')}<div class="body"><div class="prose">${md(m.text)}</div>${time}</div></div>`, day];
  const t = m.tools;
  if (t.length === 1) {
    return [`${sep}<details class="msg tools one"><summary>${icon(toolIcon(t[0].name))}<b>${esc(t[0].name)}</b><span>${esc(t[0].arg)}</span></summary>${toolRow(t[0])}</details>`, day];
  }
  const names = [...new Set(t.map((x) => x.name))];
  return [`${sep}<details class="msg tools"><summary>${icon('gear')}<b>${t.length} herramientas</b><span>${esc(names.join(', '))}</span>${icon('chevron', 'i chev')}</summary>${t.map(toolRow).join('')}</details>`, day];
}

const PAGE = 300;
let histMsgs = [], histShown = 0;

function renderHistory(prepend) {
  const chat = $('#history-chat');
  const from = Math.max(0, histMsgs.length - histShown - PAGE);
  const to = histMsgs.length - histShown;
  let html = '', day = from > 0 ? (histMsgs[from - 1].ts && new Date(histMsgs[from - 1].ts).toDateString()) : null;
  for (let i = from; i < to; i++) { const [h, d] = renderMsg(histMsgs[i], day); html += h; day = d; }
  histShown = histMsgs.length - from;
  const more = from > 0 ? `<button type="button" class="more-btn" id="btn-history-more">Cargar anteriores (${from})</button>` : '';
  if (prepend) {
    const h0 = chat.scrollHeight;
    chat.querySelector('#btn-history-more')?.remove();
    chat.insertAdjacentHTML('afterbegin', more + html);
    chat.scrollTop += chat.scrollHeight - h0;
  } else {
    chat.innerHTML = more + html;
    chat.scrollTop = chat.scrollHeight;
  }
}

const setHideTools = (on) => {
  $('#history-chat').classList.toggle('no-tools', on);
  $('#btn-hide-tools').setAttribute('aria-pressed', String(on));
  $('#btn-hide-tools').title = on ? 'Mostrar herramientas' : 'Ocultar herramientas';
};
setHideTools(store.get('hideTools', '0') === '1');
$('#btn-hide-tools').addEventListener('click', () => {
  const on = $('#btn-hide-tools').getAttribute('aria-pressed') !== 'true';
  store.set('hideTools', on ? '1' : '0'); setHideTools(on);
});
$('#history-chat').addEventListener('click', (e) => { if (e.target.closest('#btn-history-more')) renderHistory(true); });
$('#history-chat').addEventListener('scroll', (e) => {
  const c = e.target;
  $('#btn-history-end').classList.toggle('hidden', c.scrollHeight - c.scrollTop - c.clientHeight < 300);
}, { passive: true });
$('#btn-history-end').addEventListener('click', () => { const c = $('#history-chat'); c.scrollTo({ top: c.scrollHeight, behavior: 'smooth' }); });

$('#btn-history').addEventListener('click', async () => {
  const pre = $('#history-text'), chat = $('#history-chat');
  pre.textContent = 'Cargando…'; pre.classList.remove('hidden'); chat.classList.add('hidden');
  $('#btn-history-end').classList.add('hidden'); $('#history-count').textContent = '';
  $('#history').showModal();
  try {
    const res = await api(`/api/panes/${encodeURIComponent(currentPane)}/history?format=json`);
    if (Array.isArray(res?.messages)) {
      histMsgs = res.messages; histShown = 0;
      const n = histMsgs.filter((m) => m.role !== 'tools').length;
      $('#history-count').textContent = `${n} mensaje${n === 1 ? '' : 's'}`;
      pre.classList.add('hidden'); chat.classList.remove('hidden');
      renderHistory(false);
    } else {
      pre.textContent = typeof res === 'string' ? res : res?.text ?? '';
      pre.scrollTop = pre.scrollHeight;
    }
  } catch (err) { pre.textContent = err.message; }
});
$('#btn-close-history').addEventListener('click', () => $('#history').close());

// ---------------- nueva sesión ----------------
let projects = [];
const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const recentDirs = () => { try { return JSON.parse(store.get('recentDirs', '[]')); } catch { return []; } };
const folderOf = (dir) => dir.split('/').slice(-2, -1)[0] || '';

function pickProject(dir) {
  $('#new-dir').value = dir;
  const p = projects.find((x) => x.dir === dir);
  $('#new-dir-label').textContent = dir ? `Elegido: ${p ? `${p.name} · ${folderOf(dir)}` : dir}` : 'Ningún proyecto elegido';
  $('#new-dir-label').classList.toggle('muted', !dir);
  renderProjects();
}

// Filtra por todas las palabras escritas (sin importar tildes ni mayúsculas) en el nombre o la carpeta.
// Sin texto muestra primero los usados hace poco.
const rank = (p, q) => { const n = fold(p.name); return n === q ? 2 : n.startsWith(q.split(/\s+/)[0]) ? 1 : 0; };

function renderProjects() {
  const q = fold($('#new-search').value.trim());
  const recent = recentDirs();
  let list;
  if (!q) {
    list = [...recent.map((d) => projects.find((p) => p.dir === d)).filter(Boolean),
      ...projects.filter((p) => !recent.includes(p.dir))];
  } else {
    const terms = q.split(/\s+/);
    list = projects.filter((p) => { const hay = fold(`${p.name} ${folderOf(p.dir)}`); return terms.every((t) => hay.includes(t)); })
      // Primero el nombre exacto, luego los que empiezan con lo escrito, luego el resto.
      .sort((a, b) => rank(b, q) - rank(a, q) || a.name.localeCompare(b.name));
  }
  const shown = list.slice(0, 60);
  const sel = $('#new-dir').value;
  $('#project-list').innerHTML = shown.map((p) => `
    <li role="option" tabindex="0" data-dir="${esc(p.dir)}" aria-selected="${p.dir === sel}">
      <span class="pname">${icon('folder')}<span>${esc(p.name)}</span></span><span class="pfolder">${esc(folderOf(p.dir))}${recent.includes(p.dir) && !q ? ' · reciente' : ''}</span>
    </li>`).join('')
    + (list.length > shown.length ? `<li class="more">${list.length - shown.length} más; sigue escribiendo para filtrar</li>` : '')
    + (!list.length ? `<li class="more">${/^[~/]/.test(q) ? 'Ruta escrita a mano: se usará tal cual' : 'Sin coincidencias'}</li>` : '');
}

$('#new-search').addEventListener('input', () => {
  const v = $('#new-search').value.trim();
  // Una ruta escrita a mano (/… o ~/…) también vale.
  if (/^[~/]/.test(v)) pickProject(v); else renderProjects();
});
$('#project-list').addEventListener('click', (e) => {
  const li = e.target.closest('li[data-dir]');
  if (li) pickProject(li.dataset.dir);
});
$('#project-list').addEventListener('keydown', (e) => {
  const li = e.target.closest('li[data-dir]');
  if (li && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); pickProject(li.dataset.dir); }
});
$('#new-search').addEventListener('keydown', (e) => {
  // Enter en el buscador elige el primer resultado en vez de enviar el formulario.
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const first = $('#project-list li[data-dir]');
  if (first) pickProject(first.dataset.dir);
});

$('#btn-new').addEventListener('click', async () => {
  $('#new-search').value = '';
  $('#new-name').value = '';
  pickProject('');
  $('#new').showModal();
  try {
    const [list, cmds] = await Promise.all([api('/api/projects'), api('/api/commands')]);
    projects = list;
    renderProjects();
    $('#new-cmd').innerHTML = cmds.map((c) => `<option>${esc(c)}</option>`).join('');
    $('#new-cmd').value = store.get('cmd', cmds[0]);
    if (!$('#new-cmd').value) $('#new-cmd').value = cmds[0];
  } catch {}
});
$('#btn-cancel-new').addEventListener('click', () => $('#new').close());
$('#new-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const dir = $('#new-dir').value;
  if (!dir) { $('#new-search').focus(); $('#new-dir-label').textContent = 'Elige un proyecto de la lista'; return; }
  try {
    const cmd = $('#new-cmd').value;
    store.set('cmd', cmd);
    await api('/api/sessions', { method: 'POST', body: JSON.stringify({ dir, name: $('#new-name').value || undefined, cmd }) });
    store.set('recentDirs', JSON.stringify([dir, ...recentDirs().filter((d) => d !== dir)].slice(0, 5)));
    $('#new').close();
    setTimeout(refresh, 800); // da tiempo a que arranque claude
  } catch (err) { alert(err.message); }
});

// ---------------- notificaciones ----------------
const b64ToBytes = (b64) => {
  const s = atob((b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};

$('#btn-push').addEventListener('click', async () => {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) throw new Error('Este navegador no soporta push (¿estás en HTTPS?)');
    if (await Notification.requestPermission() !== 'granted') throw new Error('Permiso de notificaciones denegado');
    const reg = await navigator.serviceWorker.ready;
    const { key } = await api('/api/push/key');
    const sub = await reg.pushManager.getSubscription() || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) });
    await api('/api/push/subscribe', { method: 'POST', body: JSON.stringify(sub) });
    await api('/api/push/test', { method: 'POST', body: '{}' });
    $('#btn-push').classList.add('on'); $('#btn-push').title = 'Avisos activados';
  } catch (err) { alert(err.message); }
});

// ---------------- arranque ----------------
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js');

const initial = new URLSearchParams(location.search).get('pane');
if (initial && /^%\d+$/.test(initial)) {
  // Deja la lista "debajo" para que Atrás vuelva a ella y no cierre la app.
  history.replaceState(null, '', '/');
  refresh().then(() => openPane(initial, true));
} else showList();
