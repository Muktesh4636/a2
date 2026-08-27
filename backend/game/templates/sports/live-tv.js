/* Match platform match names → relay live TV streams (works without backend API) */
(function (global) {
  const INDEX_URL = '/sports-live/index.json';
  const CACHE_MS = 25000;
  let cache = null;
  let cacheTs = 0;

  function normalize(s) {
    return String(s || '').toLowerCase()
      .replace(/\bvs\.?\b/g, ' v ')
      .replace(/\bv\.?\b/g, ' v ')
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function tokens(name) {
    const stop = new Set(['v', 'vs', 'the', 'fc', 'sc', 'cf', 'afc', 'city', 'united', 'town', 'club', 'de', 'la', 'el', 'and', 'at', 'stade', 'uc']);
    return normalize(name).split(' ').filter(t => t && !stop.has(t));
  }

  function splitTeams(name) {
    const n = normalize(name);
    const parts = n.split(/\s+v\s+/);
    return parts.length === 2 ? [parts[0].trim(), parts[1].trim()] : [n, ''];
  }

  function teamScore(a, b) {
    if (!a || !b) return 0;
    const na = normalize(a), nb = normalize(b);
    if (na === nb || (na.length >= 4 && nb.includes(na)) || (nb.length >= 4 && na.includes(nb))) return 1;
    const ta = tokens(a), tb = tokens(b);
    if (!ta.length || !tb.length) return 0;
    const short = na.length <= nb.length ? ta : tb;
    const long = na.length <= nb.length ? nb : na;
    let hits = 0;
    for (const t of short) {
      if (t.length < 3) continue;
      if (long.includes(t)) hits += t.length >= 5 ? 1 : 0.7;
    }
    if (hits) return Math.min(1, hits / Math.max(short.length, 1));
    const setA = new Set(ta), setB = new Set(tb);
    let overlap = 0;
    for (const t of setA) if (setB.has(t)) overlap++;
    return overlap / Math.min(setA.size, setB.size);
  }

  function pairScore(platform, radhe) {
    const [pa, pb] = splitTeams(platform);
    const [ra, rb] = splitTeams(radhe);
    if (pa && pb && ra && rb) {
      const d = (teamScore(pa, ra) + teamScore(pb, rb)) / 2;
      const f = (teamScore(pa, rb) + teamScore(pb, ra)) / 2;
      return Math.max(d, f);
    }
    return teamScore(platform, radhe);
  }

  function scoreStream(stream, matchName, competition, teamNames) {
    let score = 0;
    const radhe = stream.name || '';
    if (matchName) score = Math.max(score, pairScore(matchName, radhe));
    if (competition) score = Math.max(score, pairScore(competition, radhe), teamScore(competition, radhe));
    if (teamNames && teamNames.length >= 2) {
      score = Math.max(score, pairScore(`${teamNames[0]} v ${teamNames[1]}`, radhe));
    }
    return score;
  }

  async function fetchIndex(force) {
    const now = Date.now();
    if (!force && cache && now - cacheTs < CACHE_MS) return cache;
    const r = await fetch(INDEX_URL, { headers: { Accept: 'application/json' }, cache: 'no-store' });
    if (!r.ok) throw new Error('index_unavailable');
    const data = await r.json();
    cache = (data.streams || []).map(s => ({
      ok: true,
      event_id: String(s.event_id),
      radhe_event_id: String(s.event_id),
      name: s.name,
      sport: s.sport,
      channel_id: s.channel,
      relay_hls_url: `/sports-live/${s.event_id}/stream.m3u8`,
      embed_url: null,
    }));
    cacheTs = now;
    return cache;
  }

  async function lookup(opts) {
    const matchName = opts.matchName || opts.match_name || '';
    const competition = opts.competition || '';
    const sport = (opts.sport || '').toLowerCase();
    const teamNames = opts.teamNames || opts.team_names || [];

    // Try backend API first (when deployed)
    try {
      const q = new URLSearchParams();
      if (sport) q.set('sport', sport);
      if (matchName) q.set('match_name', matchName);
      if (competition) q.set('competition', competition);
      q.set('in_play', '0');
      const r = await fetch(`/api/sports/live-tv/lookup/?${q}`, { headers: { Accept: 'application/json' } });
      if (r.ok) {
        const data = await r.json();
        if (data.ok) return data;
      }
    } catch (_) {}

    const streams = await fetchIndex(false);
    const filtered = sport
      ? streams.filter(s => s.sport === sport)
      : streams;

    let best = null, bestScore = 0;
    for (const s of filtered) {
      const sc = scoreStream(s, matchName, competition, teamNames);
      if (sc > bestScore) { bestScore = sc; best = s; }
    }
    if (!best || bestScore < 0.32) return { ok: false, error: 'not_found' };
    return { ...best, ok: true, match_score: bestScore, radhe_name: best.name };
  }

  /** Prefer embed iframe when available — HLS relay is often unavailable upstream. */
  function tvPlayback(tv) {
    tv = tv || {};
    const eid = tv.radhe_event_id || tv.event_id;
    const relayHls = tv.relay_hls_url || (eid ? `/sports-live/${eid}/stream.m3u8` : '');
    const embed = tv.embed_url || '';
    if (embed) return { mode: 'embed', embed, relayHls };
    if (relayHls) return { mode: 'hls', embed: '', relayHls };
    return { mode: 'none', embed: '', relayHls: '' };
  }

  function embedFrameHtml(url) {
    if (!url) return '';
    const esc = (s) => String(s)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;');
    return `<iframe class="live-tv-frame" src="${esc(url)}" allow="autoplay; fullscreen" referrerpolicy="no-referrer-when-downgrade"></iframe>`;
  }

  /** Mount embed or HLS player; falls back to embed on fatal HLS errors. */
  function mountPlayer(container, tv, opts) {
    opts = opts || {};
    if (!container) return { destroy: () => {} };
    const pb = tvPlayback(tv);
    const videoId = opts.videoId || 'liveTvVideo';
    const muteId = opts.muteId || 'liveTvMute';
    const emptyMsg = opts.emptyMsg || 'Stream starting soon…';
    let player = null;

    function destroy() {
      if (player && player.destroy) player.destroy();
      player = null;
    }

    if (pb.mode === 'embed') {
      container.innerHTML = embedFrameHtml(pb.embed);
      return { destroy };
    }
    if (pb.mode === 'hls') {
      let markup = global.GunduLiveTv.videoMarkup();
      markup = markup.replace(/id="liveTvVideo"/g, `id="${videoId}"`);
      markup = markup.replace(/id="liveTvMute"/g, `id="${muteId}"`);
      container.innerHTML = markup;
      const video = document.getElementById(videoId);
      player = global.GunduLiveTv.createPlayer(video, pb.relayHls, {
        onFatal: () => {
          destroy();
          if (pb.embed) {
            container.innerHTML = embedFrameHtml(pb.embed);
          } else {
            container.innerHTML = `<div class="live-tv-msg">${emptyMsg}</div>`;
          }
        },
      });
      const btn = document.getElementById(muteId);
      if (btn && video) {
        btn.onclick = (e) => {
          e.stopPropagation();
          video.muted = !video.muted;
          btn.textContent = video.muted ? '🔇' : '🔊';
        };
      }
      return { destroy: () => { destroy(); container.innerHTML = ''; } };
    }
    container.innerHTML = `<div class="live-tv-msg">${emptyMsg}</div>`;
    return { destroy: () => { container.innerHTML = ''; } };
  }

  global.GunduLiveTv = { lookup, fetchIndex, pairScore, scoreStream, tvPlayback, embedFrameHtml, mountPlayer };

  /** Best match score between a platform event and a relay stream (0–1). */
  global.GunduLiveTv.scoreEventStream = function (stream, opts) {
    opts = opts || {};
    const matchName = opts.matchName || opts.match_name || '';
    const competition = opts.competition || opts.league || '';
    const teamNames = opts.teamNames || opts.team_names || [];
    return scoreStream(stream, matchName, competition, teamNames);
  };

  global.GunduLiveTv.hlsConfig = function () {
    return {
      enableWorker: true,
      lowLatencyMode: false,
      liveSyncDuration: 6,
      liveMaxLatencyDuration: 25,
      maxLiveSyncPlaybackRate: 1.05,
      maxBufferLength: 30,
      maxMaxBufferLength: 45,
      backBufferLength: 20,
      manifestLoadingMaxRetry: 10,
      fragLoadingMaxRetry: 10,
      startFragPrefetch: true,
      maxBufferHole: 0.6,
      nudgeMaxRetry: 5,
    };
  };

  global.GunduLiveTv.videoMarkup = function () {
    return `<div class="live-tv-body">
      <video class="live-tv-video" id="liveTvVideo" playsinline webkit-playsinline muted autoplay disablepictureinpicture disableremoteplayback></video>
      <button type="button" class="live-tv-mute" id="liveTvMute" aria-label="Sound off">🔇</button>
    </div>`;
  };

  global.GunduLiveTv.wireSpeaker = function (video) {
    const btn = document.getElementById('liveTvMute');
    if (!video) return;
    if (video.dataset.speakerWired === '1') return;
    video.dataset.speakerWired = '1';
    video.controls = false;
    video.setAttribute('controlsList', 'nodownload noplaybackrate nofullscreen noremoteplayback');
    video.setAttribute('disablepictureinpicture', '');
    video.addEventListener('contextmenu', (e) => e.preventDefault());
    let resumeTimer = null;
    video.addEventListener('waiting', () => {
      clearTimeout(resumeTimer);
      resumeTimer = setTimeout(() => {
        if (document.hidden || video.ended) return;
        video.play().catch(() => {});
      }, 200);
    });
    const sync = () => {
      if (!btn) return;
      btn.textContent = video.muted ? '🔇' : '🔊';
      btn.setAttribute('aria-label', video.muted ? 'Turn sound on' : 'Turn sound off');
      btn.classList.toggle('muted', video.muted);
    };
    sync();
    if (btn) {
      btn.onclick = (e) => {
        e.stopPropagation();
        video.muted = !video.muted;
        sync();
      };
    }
  };

  global.GunduLiveTv.createPlayer = function (video, src, opts) {
    opts = opts || {};
    let hls = null;
    if (video && src && video.dataset.liveSrc === src && video.dataset.livePlayer === '1' && !video.paused) {
      return { hls: video._gunduHls || null, destroy: () => {} };
    }
    function destroy() {
      if (hls) { hls.destroy(); hls = null; }
      if (video) {
        video.pause();
        video.removeAttribute('src');
        video.dataset.liveSrc = '';
        video.dataset.livePlayer = '';
        video.dataset.speakerWired = '';
        video._gunduHls = null;
        video.load();
      }
    }
    destroy();
    if (!video || !src) return { destroy };

    if (window.Hls && Hls.isSupported()) {
      hls = new Hls(global.GunduLiveTv.hlsConfig());
      hls.loadSource(src);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.muted = true;
        video.dataset.liveSrc = src;
        video.dataset.livePlayer = '1';
        global.GunduLiveTv.wireSpeaker(video);
        video.play().catch(() => {});
      });
      let netFails = 0;
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (!data.fatal) return;
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          netFails += 1;
          if (netFails >= 3 && opts.onFatal) {
            destroy();
            opts.onFatal(data);
            return;
          }
          hls.startLoad();
        } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          hls.recoverMediaError();
        } else if (opts.onFatal) {
          destroy();
          opts.onFatal(data);
        }
      });
      video._gunduHls = hls;
      return { hls, destroy };
    }
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = src;
      video.muted = true;
      video.dataset.liveSrc = src;
      video.dataset.livePlayer = '1';
      global.GunduLiveTv.wireSpeaker(video);
      video.play().catch(() => {});
    }
    if (hls) video._gunduHls = hls;
    return { destroy };
  };
})(typeof window !== 'undefined' ? window : globalThis);
