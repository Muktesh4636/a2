#!/usr/bin/env node
/**
 * Pull all Radhe Exchange in-play HLS feeds to local /hls/{event_id}/stream.m3u8
 * Restarts per-event ffmpeg when upstream drops; stops relays when events end.
 */
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const API_BASE = process.env.RADHE_API_BASE || 'https://api.radhexchange.com';
const DOMAIN = process.env.RADHE_DOMAIN || 'radhexchange.com';
const DEMO_USER = process.env.RADHE_DEMO_USER || 'Demo123';
const DEMO_PASS = process.env.RADHE_DEMO_PASS || '123456';
const FT_LIVETV_BASE = process.env.RADHE_LIVETV_BASE ||
  'https://premiumodds.cc/score/f50d78a6b623eb7d72eb4bf79800e0217e6b401d/';
const PREMIUM_TOKEN = FT_LIVETV_BASE.replace(/\/$/, '').split('/').pop();
const AES_KEY = 'Shubham.711';
const DESYNC = 300;
const LIFETIME = 3600 * 3;

const RELAY_IP = process.env.SPORTS_LIVE_RELAY_IP || '72.61.254.71';
const OUT_DIR = process.env.OUT_DIR || '/hls';
const POLL_SEC = Number(process.env.POLL_SEC || 30);
const MAX_STREAMS = Number(process.env.MAX_STREAMS || 24);
const NO_HLS_RETRY_SEC = Number(process.env.NO_HLS_RETRY_SEC || 15);

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/** @type {Map<string, { abort: AbortController, name: string, channel: string, sport: string }>} */
const workers = new Map();
let authToken = null;
let authExpires = 0;

function log(msg) {
  console.log(`[sports-live] ${new Date().toISOString()} ${msg}`);
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function postJson(url, body, headers = {}) {
  const u = new URL(url);
  const data = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        'User-Agent': UA,
        Origin: 'https://radhexchange.com',
        Referer: 'https://radhexchange.com/',
        ...headers,
      },
    }, res => {
      let d = '';
      res.on('data', c => (d += c));
      res.on('end', () => {
        try { resolve(JSON.parse(d)); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function getText(url, headers = {}) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        'User-Agent': UA,
        Origin: 'https://radhexchange.com',
        Referer: 'https://radhexchange.com/',
        ...headers,
      },
    }, res => {
      let d = '';
      res.on('data', c => (d += c));
      res.on('end', () => resolve(d));
    }).on('error', reject);
  });
}

function evpBytesToKey(password, salt, keyLen, ivLen) {
  let derived = Buffer.alloc(0), block = Buffer.alloc(0);
  while (derived.length < keyLen + ivLen) {
    block = crypto.createHash('md5').update(Buffer.concat([block, Buffer.from(password), salt])).digest();
    derived = Buffer.concat([derived, block]);
  }
  return { key: derived.slice(0, keyLen), iv: derived.slice(keyLen, keyLen + ivLen) };
}

function decrypt(encB64) {
  const data = Buffer.from(encB64, 'base64');
  const salt = data.slice(8, 16), ct = data.slice(16);
  const { key, iv } = evpBytesToKey(AES_KEY, salt, 32, 16);
  const dec = crypto.createDecipheriv('aes-256-cbc', key, iv);
  return JSON.parse(Buffer.concat([dec.update(ct), dec.final()]).toString('utf8'));
}

function generateHlsToken(channel, ip) {
  const start = Math.floor(Date.now() / 1000) - DESYNC;
  const end = start + LIFETIME;
  const rand = crypto.randomBytes(16).toString('hex');
  const payload = `${channel}${ip}${start}${end}${AES_KEY}${rand}`;
  const sha = crypto.createHash('sha1').update(payload).digest('hex');
  return `${sha}-${rand}-${end}-${start}`;
}

async function login() {
  const now = Date.now();
  if (authToken && now < authExpires - 60000) return authToken;
  const j = await postJson(`${API_BASE}/api/auth`, {
    username: DEMO_USER,
    password: DEMO_PASS,
    domain: DOMAIN,
  });
  authToken = j.data.access_token;
  authExpires = now + (j.data.expires_in || 3600) * 1000;
  return authToken;
}

const SPORT_BY_TYPE = { 1: 'soccer', 2: 'tennis', 4: 'cricket' };

async function fetchInPlayEvents() {
  const token = await login();
  const raw = await getText(`${API_BASE}/api/client/event_list`, {
    Authorization: `bearer ${token}`,
  });
  const events = (JSON.parse(raw).data || {}).events || [];
  return events
    .filter(e => e.in_play && e.tv_channel)
    .map(e => ({
      event_id: String(e.event_id),
      name: e.name || '',
      channel: String(e.tv_channel),
      sport: SPORT_BY_TYPE[e.event_type_id] || 'unknown',
    }));
}

async function resolveHls(channel) {
  const embed = `${FT_LIVETV_BASE.replace(/\/$/, '')}/${channel}`;
  try {
    const score = await postJson('https://premiumodds.cc/score-api/score/get-by-score', {
      channel,
      token: PREMIUM_TOKEN,
      referrerDomain: DOMAIN,
      countryCode: 'IN',
      ip: RELAY_IP,
    }, { Referer: embed });

    if (!score.model) return null;
    const data = decrypt(score.model);
    const md = data.matchData || {};
    const pu = data.playerUser || {};
    const blocked = ['streamSoon', 'inningBreak', 'eventEnd', 'rainStart', 'sourceIssue']
      .some(f => md[f]);
    const hlsDomain = (pu.hlsDomain || '').replace(/\/$/, '');
    if (blocked || !hlsDomain) return null;
    const hlsToken = generateHlsToken(channel, RELAY_IP);
    return `${hlsDomain}/${channel}/index.m3u8?user=${PREMIUM_TOKEN}&token=${hlsToken}&ip=${RELAY_IP}`;
  } catch (e) {
    return null;
  }
}

function writeIndex(active) {
  const payload = {
    updated_at: new Date().toISOString(),
    relay_ip: RELAY_IP,
    count: active.length,
    streams: active,
  };
  try {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(path.join(OUT_DIR, 'index.json'), JSON.stringify(payload, null, 2));
  } catch (e) {
    log(`index write failed: ${e.message}`);
  }
}

function runFfmpeg(source, playlist, signal, referer) {
  return new Promise((resolve) => {
    const hdr = `User-Agent: ${UA}\r\nReferer: ${referer || FT_LIVETV_BASE}\r\n`;
    const args = [
      '-hide_banner', '-loglevel', 'warning',
      '-rw_timeout', '20000000',
      '-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5',
      '-headers', hdr,
      '-i', source,
      '-c', 'copy',
      '-f', 'hls',
      '-hls_time', '4',
      '-hls_list_size', '18',
      '-hls_flags', 'append_list+omit_endlist+program_date_time+split_by_time+independent_segments',
      playlist,
    ];
    const child = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', c => { stderr = (stderr + c.toString()).slice(-500); });
    const onDone = (code) => {
      if (code !== 0 && code !== null) log(`ffmpeg exit ${code}: ${stderr.trim()}`);
      resolve(code);
    };
    child.on('exit', onDone);
    child.on('error', () => onDone(1));
    if (signal) {
      signal.addEventListener('abort', () => {
        try { child.kill('SIGTERM'); } catch (_) {}
        setTimeout(() => { try { child.kill('SIGKILL'); } catch (_) {} }, 2000);
      });
    }
  });
}

async function relayWorker(ev, abortSignal) {
  const eventId = ev.event_id;
  const outPath = path.join(OUT_DIR, eventId);
  const playlist = path.join(outPath, 'stream.m3u8');
  fs.mkdirSync(outPath, { recursive: true });

  log(`start relay event=${eventId} channel=${ev.channel} sport=${ev.sport} name=${ev.name}`);

  while (!abortSignal.aborted) {
    const source = await resolveHls(ev.channel);
    if (!source) {
      log(`no HLS yet event=${eventId} (${ev.name}), retry in ${NO_HLS_RETRY_SEC}s`);
      await sleep(NO_HLS_RETRY_SEC * 1000);
      if (abortSignal.aborted) break;
      continue;
    }

    log(`pulling event=${eventId} ${source.slice(0, 80)}...`);
    const embed = `${FT_LIVETV_BASE.replace(/\/$/, '')}/${ev.channel}`;
    await runFfmpeg(source, playlist, abortSignal, embed);
    if (abortSignal.aborted) break;
    log(`ffmpeg stopped event=${eventId}, re-resolving in 3s`);
    await sleep(3000);
  }

  log(`stopped relay event=${eventId}`);
}

function startWorker(ev) {
  const ac = new AbortController();
  workers.set(ev.event_id, {
    abort: ac,
    name: ev.name,
    channel: ev.channel,
    sport: ev.sport,
  });
  relayWorker(ev, ac.signal).finally(() => workers.delete(ev.event_id));
}

function stopWorker(eventId) {
  const w = workers.get(eventId);
  if (!w) return;
  log(`stopping event=${eventId} (${w.name})`);
  w.abort.abort();
  workers.delete(eventId);
}

async function reconcile() {
  let events = [];
  try {
    events = await fetchInPlayEvents();
  } catch (e) {
    log(`event list failed: ${e.message}`);
    return;
  }

  const want = new Map(events.map(e => [e.event_id, e]));
  const wantIds = new Set(want.keys());

  // Stop ended events
  for (const id of [...workers.keys()]) {
    if (!wantIds.has(id)) stopWorker(id);
  }

  // Start new events (respect MAX_STREAMS)
  const slots = MAX_STREAMS - workers.size;
  if (slots <= 0 && want.size > workers.size) {
    log(`at MAX_STREAMS=${MAX_STREAMS}, skipping new relays`);
  }

  let started = 0;
  for (const ev of events) {
    if (workers.has(ev.event_id)) continue;
    if (started >= slots) break;
    startWorker(ev);
    started += 1;
  }

  const active = [...workers.entries()].map(([id, w]) => ({
    event_id: id,
    name: w.name,
    channel: w.channel,
    sport: w.sport,
    playlist: `/hls/${id}/stream.m3u8`,
  }));
  writeIndex(active);
  log(`in_play=${events.length} relaying=${workers.size} started=${started}`);
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  log(`manager started relay_ip=${RELAY_IP} poll=${POLL_SEC}s max=${MAX_STREAMS}`);
  await reconcile();
  setInterval(reconcile, POLL_SEC * 1000);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
