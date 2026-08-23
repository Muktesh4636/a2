#!/usr/bin/env node
/**
 * Resolve Radhe Exchange / premiumodds HLS URL for relay.
 * Usage: node resolve_stream.js <radhe_event_id> [relay_ip]
 */
const https = require('https');
const crypto = require('crypto');

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

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

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
  const j = await postJson(`${API_BASE}/api/auth`, {
    username: DEMO_USER,
    password: DEMO_PASS,
    domain: DOMAIN,
  });
  return j.data.access_token;
}

async function main() {
  const args = process.argv.slice(2);
  const channelOnly = args[0] === '--channel';
  const eventId = channelOnly ? null : args[0];
  const channelArg = channelOnly ? args[1] : null;
  const relayIp = (channelOnly ? args[2] : args[1]) || process.env.SPORTS_LIVE_RELAY_IP || '72.61.254.71';
  if (!eventId && !channelArg) {
    console.error('usage: resolve_stream.js <event_id> [relay_ip] | resolve_stream.js --channel <id> [relay_ip]');
    process.exit(2);
  }

  let channel = channelArg;
  if (!channel) {
    const token = await login();
    const html = await getText(`${API_BASE}/api/client/stream/${eventId}`, {
      Authorization: `bearer ${token}`,
    });
    const m = html.match(/get_tv2_url\/(\d+)\//);
    if (!m) {
      console.error(JSON.stringify({ ok: false, error: 'no_channel' }));
      process.exit(1);
    }
    channel = m[1];
  }
  const embed = `${FT_LIVETV_BASE.replace(/\/$/, '')}/${channel}`;

  const score = await postJson('https://premiumodds.cc/score-api/score/get-by-score', {
    channel,
    token: PREMIUM_TOKEN,
    referrerDomain: DOMAIN,
    countryCode: 'IN',
    ip: relayIp,
  }, { Referer: embed });

  let hls = null;
  if (score.model) {
    const data = decrypt(score.model);
    const md = data.matchData || {};
    const pu = data.playerUser || {};
    const flags = ['streamSoon', 'inningBreak', 'eventEnd', 'rainStart', 'sourceIssue'];
    const blocked = flags.some(f => md[f]);
    const hlsDomain = (pu.hlsDomain || '').replace(/\/$/, '');
    if (!blocked && hlsDomain) {
      const hlsToken = generateHlsToken(channel, relayIp);
      hls = `${hlsDomain}/${channel}/index.m3u8?user=${PREMIUM_TOKEN}&token=${hlsToken}&ip=${relayIp}`;
    }
  }

  console.log(JSON.stringify({ ok: true, event_id: eventId || null, channel_id: channel, embed_url: embed, hls_upstream: hls }));
}

main().catch(e => {
  console.error(JSON.stringify({ ok: false, error: String(e) }));
  process.exit(1);
});
