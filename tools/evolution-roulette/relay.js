#!/usr/bin/env node
/**
 * Evolution Auto Roulette → local HLS (/hls/auto-roulette/stream.m3u8)
 *
 * Opens 4RABET game with FOURABET_ACCESS_TOKEN, captures <video> via MediaRecorder,
 * pipes webm chunks to ffmpeg, outputs HLS segments.
 */
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const TOKEN = process.env.FOURABET_ACCESS_TOKEN || '';
const COOKIES_JSON = process.env.FOURABET_COOKIES_JSON || '';
const GAME_URL = process.env.GAME_URL || 'https://4rabet365.com/casino/slot/auto-roulette-13';
const OUT_DIR = process.env.OUT_DIR || '/hls/auto-roulette';

function log(msg) {
  console.log(`[roulette-live] ${new Date().toISOString()} ${msg}`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function startFfmpeg() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const playlist = path.join(OUT_DIR, 'stream.m3u8');
  const seg = path.join(OUT_DIR, 'seg_%05d.ts');
  return spawn(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'warning',
      '-fflags',
      '+genpts',
      '-f',
      'webm',
      '-i',
      'pipe:0',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-tune',
      'zerolatency',
      '-pix_fmt',
      'yuv420p',
      '-g',
      '48',
      '-keyint_min',
      '48',
      '-sc_threshold',
      '0',
      '-an',
      '-f',
      'hls',
      '-hls_time',
      '2',
      '-hls_list_size',
      '12',
      '-hls_flags',
      'delete_segments+append_list+omit_endlist+program_date_time',
      '-hls_segment_filename',
      seg,
      playlist,
    ],
    { stdio: ['pipe', 'inherit', 'inherit'] },
  );
}

async function fetchLaunchUrl() {
  const url = `https://api.4rabet365.com/api/v1/slots/auto-roulette-13/play?demo=0&device=desktop&return_url=${encodeURIComponent(GAME_URL)}`;
  const r = await fetch(url, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/json',
      Origin: 'https://4rabet365.com',
      Referer: GAME_URL,
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    },
  });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw new Error(`play API ${r.status}: ${body.slice(0, 200)}`);
  }
  const data = await r.json();
  if (data.url) return data.url;
  throw new Error(`play API empty url: ${JSON.stringify(data).slice(0, 200)}`);
}

async function findLaunchUrl(page) {
  for (const fr of page.frames()) {
    const u = fr.url();
    if (u.includes('sessionToken=') && (u.includes('eva-digital') || u.includes('lpgnuzzlwn') || u.includes('frontend/evo'))) {
      return u;
    }
  }
  return null;
}

async function findVideoFrame(page) {
  for (const fr of page.frames()) {
    try {
      const n = await fr.evaluate(() => {
        let count = 0;
        const walk = (win) => {
          try {
            win.document.querySelectorAll('video').forEach((v) => {
              if (v.videoWidth > 240) count += 1;
            });
            win.document.querySelectorAll('iframe').forEach((f) => {
              try {
                if (f.contentWindow) walk(f.contentWindow);
              } catch (_) {}
            });
          } catch (_) {}
        };
        walk(window);
        return count;
      });
      if (n > 0) return fr;
    } catch (_) {}
  }
  return null;
}

const START_RELAY_JS = `
(() => {
  if (window.__rouletteRelayStarted) return { ok: true, already: true };
  const walk = (win, out = []) => {
    try {
      win.document.querySelectorAll('video').forEach((v) => out.push(v));
      win.document.querySelectorAll('iframe').forEach((f) => {
        try { if (f.contentWindow) walk(f.contentWindow, out); } catch (_) {}
      });
    } catch (_) {}
    return out;
  };
  const video = walk(window)
    .filter((v) => v.videoWidth > 240 && v.videoHeight > 180)
    .sort((a, b) => (b.videoWidth * b.videoHeight) - (a.videoWidth * a.videoHeight))[0];
  if (!video) return { ok: false, error: 'no_video' };
  const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
    ? 'video/webm;codecs=vp9'
    : 'video/webm';
  const rec = new MediaRecorder(video.captureStream(), {
    mimeType: mime,
    videoBitsPerSecond: 4500000,
  });
  rec.ondataavailable = async (e) => {
    if (!e.data || !e.data.size) return;
    const buf = await e.data.arrayBuffer();
    await window.relayChunk(Array.from(new Uint8Array(buf)));
  };
  rec.start(2000);
  window.__rouletteRelayStarted = true;
  return { ok: true, w: video.videoWidth, h: video.videoHeight };
})()
`;

async function runSession() {
  if (!TOKEN) throw new Error('FOURABET_ACCESS_TOKEN is required');

  const ffmpeg = startFfmpeg();
  ffmpeg.stdin.on('error', () => {});

  const browser = await chromium.launch({
    headless: false,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--disable-dev-shm-usage'],
  });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    locale: 'en-IN',
  });
  if (COOKIES_JSON) {
    try {
      await ctx.addCookies(JSON.parse(COOKIES_JSON));
      log(`loaded ${JSON.parse(COOKIES_JSON).length} cookies`);
    } catch (e) {
      log(`cookie load failed: ${e.message}`);
    }
  }
  const page = await ctx.newPage();

  await page.exposeFunction('relayChunk', (arr) => {
    const buf = Buffer.from(Uint8Array.from(arr));
    if (ffmpeg.stdin.writable) ffmpeg.stdin.write(buf);
  });

  log('loading 4rabet session…');
  await page.goto('https://4rabet365.com/', { waitUntil: 'domcontentloaded', timeout: 120000 });
  log('injecting token…');
  await page.evaluate((t) => {
    localStorage.setItem(
      'vuexx',
      JSON.stringify({
        access_token: t,
        token_type: 'Bearer',
        refresh_token: '',
        expires_in: 3600,
      }),
    );
  }, TOKEN);

  let launch = null;
  try {
    launch = await fetchLaunchUrl();
    log(`play API ok`);
  } catch (e) {
    log(`play API failed: ${e.message}`);
  }

  log('opening game page…');
  await page.goto(GAME_URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await sleep(5000);

  let frame = null;
  for (let i = 0; i < 60; i++) {
    launch = (await findLaunchUrl(page)) || launch;
    if (launch && launch.includes('sessionToken=') && !page.url().includes('lpgnuzzlwn') && !page.url().includes('frontend/evo')) {
      try {
        log(`following evolution ${launch.slice(0, 90)}…`);
        await page.goto(launch, { waitUntil: 'domcontentloaded', timeout: 120000 });
        await sleep(15000);
      } catch (_) {}
    }
    frame = await findVideoFrame(page);
    if (frame) break;
    if (i % 3 === 0) {
      const frames = page.frames().map((f) => f.url()).filter(Boolean);
      log(`waiting for video… (${i * 5}s) page=${page.url().slice(0, 80)} frames=${frames.length}`);
      frames.slice(0, 5).forEach((u) => log(`  frame: ${u.slice(0, 120)}`));
    }
    await sleep(5000);
  }
  if (!frame) throw new Error('Evolution video never started');

  const res = await frame.evaluate(START_RELAY_JS);
  if (!res.ok) throw new Error(`relay start failed: ${JSON.stringify(res)}`);
  log(`streaming ${res.w}x${res.h} → ${path.join(OUT_DIR, 'stream.m3u8')}`);

  await new Promise((resolve) => {
    const done = (why) => {
      log(`session ended: ${why}`);
      resolve();
    };
    page.on('close', () => done('page closed'));
    ffmpeg.on('close', () => done('ffmpeg exited'));
    setInterval(async () => {
      const fr = await findVideoFrame(page);
      if (!fr) done('video lost');
    }, 30000);
  });

  try {
    ffmpeg.stdin.end();
  } catch (_) {}
  await browser.close().catch(() => {});
}

async function main() {
  log('relay starting');
  while (true) {
    try {
      await runSession();
    } catch (e) {
      log(`error: ${e.message}`);
    }
    await sleep(15000);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
