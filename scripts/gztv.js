/**
 * MoonTV 视频源脚本 — 瓜子影视 (gztv.nalinali.qzz.io)
 *
 * 基于 AppCMS V10 API，适配 MoonTV 脚本接口规范。
 * 搜索走 /api/appcms?ac=videolist&wd=xxx，详情走 ?ac=videolist&ids=xxx。
 * 播放地址为 m3u8 直链，无需额外解析。
 */

const API_BASE = 'https://gztv.nalinali.qzz.io/api/appcms';
const SOURCE_ID = 'gztv5';
const SOURCE_NAME = '瓜子影视';
const TIMEOUT_MS = 15000;

// ── 辅助函数 ──────────────────────────────────────────────────────

function extractEpisodes(vodPlayUrl) {
  if (!vodPlayUrl || typeof vodPlayUrl !== 'string') {
    return { episodes: [], titles: [] };
  }
  const episodes = [];
  const titles = [];
  for (const part of vodPlayUrl.split('#')) {
    const idx = part.indexOf('$');
    if (idx < 0) continue;
    const name = part.slice(0, idx);
    const url = part.slice(idx + 1);
    if (url && /^https?:\/\//.test(url)) {
      episodes.push(url);
      titles.push(name);
    }
  }
  return { episodes, titles };
}

function mapListItem(item, sid) {
  const { episodes, titles } = extractEpisodes(item.vod_play_url);
  return {
    id: String(item.vod_id || ''),
    title: (item.vod_name || '').trim(),
    poster: item.vod_pic || '',
    episodes,
    episodes_titles: titles,
    source: sid,
    source_name: SOURCE_NAME,
    class: item.vod_class || '',
    year: item.vod_year || item.vod_time || '',
    desc: item.vod_content || item.vod_blurb || '',
    type_name: item.type_name || '',
    douban_id: item.vod_douban_id ? Number(item.vod_douban_id) : undefined,
    remarks: item.vod_remarks || '',
    score: item.vod_score || '',
    area: item.vod_area || '',
    director: item.vod_director || '',
    actors: item.vod_actor || '',
  };
}

// ── HTTP 请求 ─────────────────────────────────────────────────────

async function apiGet(ctx, params, timeoutMs) {
  const timeout = timeoutMs || TIMEOUT_MS;

  // 手动拼接 URL（new URL() 在脚本沙箱中不可用）
  let urlStr = API_BASE + '?';
  const parts = [];
  for (const [k, v] of Object.entries(params)) {
    parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(v));
  }
  urlStr += parts.join('&');

  const headers = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    Accept: 'application/json',
  };

  // 超时控制（不依赖 AbortController）
  function withTimeout(promise, ms) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timeout after ' + ms + 'ms')), ms);
      promise.then(
        (val) => { clearTimeout(timer); resolve(val); },
        (err) => { clearTimeout(timer); reject(err); }
      );
    });
  }

  try {
    let resp;

    // 1) MoonTV 内置 HTTP 客户端（直接返回 JSON 对象）
    if (ctx && typeof ctx.http === 'function') {
      resp = await withTimeout(ctx.http(urlStr, { headers, timeout }), timeout);
    }
    // 2) ctx 级 fetch
    else if (ctx && typeof ctx.fetch === 'function') {
      resp = await withTimeout(ctx.fetch(urlStr, { headers }), timeout);
    }
    // 3) 全局 fetch（兜底）
    else if (typeof fetch === 'function') {
      resp = await withTimeout(fetch(urlStr, { headers }), timeout);
    } else {
      ctx.log.warn('[gztv] No HTTP client available');
      return null;
    }

    // 处理 Response 对象（fetch 返回）
    if (resp && typeof resp.json === 'function') {
      if (!resp.ok) {
        ctx.log.warn('[gztv] HTTP', resp.status, urlStr);
        return null;
      }
      return await resp.json();
    }

    // 处理已解析的对象（ctx.http 直接返回 JSON）
    if (resp && typeof resp === 'object' && 'code' in resp) {
      return resp;
    }

    // 尝试 JSON.parse（某些客户端返回字符串）
    if (typeof resp === 'string') {
      try { return JSON.parse(resp); } catch (_) {}
    }

    ctx.log.warn('[gztv] Unexpected response:', typeof resp, String(resp).slice(0, 200));
    return null;
  } catch (e) {
    ctx.log.warn('[gztv] HTTP error:', e.message || String(e));
    return null;
  }
}

// ── 脚本接口 ──────────────────────────────────────────────────────

return {
  meta: {
    name: '瓜子影视',
    author: 'Theadvocate-bit',
    description: 'AppCMS V10 — gztv5.com 数据源，m3u8 直链',
  },

  async getSources(ctx) {
    return [
      { id: SOURCE_ID, name: SOURCE_NAME },
    ];
  },

  async search(ctx, { keyword, page, sourceId }) {
    const sid = sourceId || SOURCE_ID;
    const pg = page || 1;
    ctx.log.info('[gztv] search', JSON.stringify({ keyword, page: pg, sourceId: sid }));

    const data = await apiGet(ctx, {
      ac: 'videolist',
      wd: keyword,
      pg: String(pg),
      limit: '20',
    });

    if (!data || data.code !== 1 || !Array.isArray(data.list)) {
      if (data) {
        ctx.log.warn('[gztv] API returned', JSON.stringify({
          code: data.code,
          msg: data.msg,
          hasList: !!data.list,
        }));
      }
      return { sourceId: sid, list: [], page: pg, pageCount: 1, total: 0 };
    }

    return {
      sourceId: sid,
      list: data.list.map((item) => mapListItem(item, sid)),
      page: parseInt(data.page, 10) || pg,
      pageCount: parseInt(data.pagecount, 10) || 1,
      total: parseInt(data.total, 10) || 0,
    };
  },

  async recommend(ctx, { page, typeId, sourceId }) {
    const sid = sourceId || SOURCE_ID;
    const pg = page || 1;
    ctx.log.info('[gztv] recommend', JSON.stringify({ page: pg, typeId, sourceId: sid }));

    const params = {
      ac: 'list',
      page: String(pg),
      limit: '20',
    };
    if (typeId) params.type_id = String(typeId);

    const data = await apiGet(ctx, params);

    if (!data || data.code !== 1 || !Array.isArray(data.list)) {
      return { list: [], page: pg, pageCount: 1, total: 0 };
    }

    return {
      list: data.list.map((item) => mapListItem(item, sid)),
      page: parseInt(data.page, 10) || pg,
      pageCount: parseInt(data.pagecount, 10) || 1,
      total: parseInt(data.total, 10) || 0,
      class: data.class || [],
    };
  },

  async detail(ctx, { id, sourceId }) {
    const sid = sourceId || SOURCE_ID;
    ctx.log.info('[gztv] detail', JSON.stringify({ id, sourceId: sid }));

    const data = await apiGet(ctx, {
      ac: 'videolist',
      ids: String(id),
    });

    const item = data && data.list && data.list[0];
    if (!item) {
      return {
        id: String(id),
        sourceId: sid,
        title: '',
        poster: '',
        year: '',
        desc: '',
        playbacks: [],
      };
    }

    const { episodes, titles } = extractEpisodes(item.vod_play_url);

    return {
      id: String(item.vod_id || id),
      sourceId: sid,
      title: item.vod_name || '',
      poster: item.vod_pic || '',
      year: item.vod_year || '',
      desc: item.vod_content || '',
      class: item.vod_class || '',
      type_name: item.type_name || '',
      area: item.vod_area || '',
      score: item.vod_score || '',
      douban_id: item.vod_douban_id ? Number(item.vod_douban_id) : undefined,
      remarks: item.vod_remarks || '',
      director: item.vod_director || '',
      actors: item.vod_actor || '',
      playbacks: [
        {
          sourceId: sid,
          sourceName: SOURCE_NAME,
          episodes,
          episodes_titles: titles,
        },
      ],
    };
  },

  async resolvePlayUrl(ctx, { playUrl, sourceId, episodeIndex }) {
    ctx.log.info('[gztv] resolvePlayUrl', JSON.stringify({
      sourceId,
      episodeIndex,
      url: playUrl ? playUrl.slice(0, 80) + '...' : 'null',
    }));

    if (!playUrl) {
      return { url: '', type: 'none', headers: {} };
    }

    return {
      url: playUrl,
      type: 'hls',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        Referer: 'https://gztv5.com/',
      },
    };
  },
};
