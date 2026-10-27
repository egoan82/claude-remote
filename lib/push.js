// Notificaciones Web Push. Las llaves VAPID y las suscripciones viven en data/.
import webpush from 'web-push';
import fs from 'node:fs';
import path from 'node:path';

const DATA = path.resolve(process.env.DATA_DIR || new URL('../data', import.meta.url).pathname);
const KEYS = path.join(DATA, 'vapid.json');
const SUBS = path.join(DATA, 'subscriptions.json');

fs.mkdirSync(DATA, { recursive: true, mode: 0o700 });

const readJson = (f, fallback) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fallback; } };
const writeJson = (f, v) => fs.writeFileSync(f, JSON.stringify(v, null, 2), { mode: 0o600 });

let keys = readJson(KEYS, null);
if (!keys) { keys = webpush.generateVAPIDKeys(); writeJson(KEYS, keys); }
webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:claude-remote@localhost', keys.publicKey, keys.privateKey);

let subs = readJson(SUBS, []);

export const publicKey = keys.publicKey;

export function subscribe(sub) {
  if (!sub?.endpoint || !/^https:\/\//.test(sub.endpoint)) throw new Error('suscripción inválida');
  subs = subs.filter((s) => s.endpoint !== sub.endpoint).concat(sub);
  writeJson(SUBS, subs);
}

export async function notify(payload) {
  const body = JSON.stringify(payload);
  const dead = [];
  await Promise.all(subs.map((s) => webpush.sendNotification(s, body, { TTL: 300, urgency: 'high' }).catch((err) => {
    if (err.statusCode === 404 || err.statusCode === 410) dead.push(s.endpoint);
    else console.error('push falló:', err.statusCode || err.message);
  })));
  if (dead.length) { subs = subs.filter((s) => !dead.includes(s.endpoint)); writeJson(SUBS, subs); }
  return subs.length;
}
