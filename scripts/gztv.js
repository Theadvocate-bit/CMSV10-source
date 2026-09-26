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

// ── 辅助函数 ──────────────────────────────────────────────────────

function extractEpisodes(vodPlayUrl) {
  /**
   * 解析 AppCMS V10 的 vod_play_url 字段。
   * 格式: "集数名$url1#集数名$url2#..."，'$' 分隔名称/URL，'#' 分隔不同集。
   * 返回列表: { episodes: string[], titles: string[] }
   */
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

function mapListItem(item, sourceId) {
  /**
   * 将 AppCMS V10 list 项映射为 MoonTV SearchResult 格式。
   */
  const { episodes, titles } = extractEpisodes(item.vod_play_url);
  return {
    id: String(item.vod_id || ''),
    title: (item.vod_name || '').trim(),
    poster: item.vod_pic || '',
    episodes,
    episodes_titles: titles,
    source: sourceId,
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

async function apiGet(params, timeoutMs) {
  /**
   * 通用 GET 请求，带超时和错误处理。
   */
  const url = new URL(API_BASE);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || 10000);
  try {
    const resp = await fetch(url.toString(), {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        Accept: 'application/json',
      },
    });
    if (!resp.ok) return null;
    return await resp.json();
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ── 脚本接口 ──────────────────────────────────────────────────────

return {
  meta: {
    name: '瓜子影视',
    author: 'Theadvocate-bit',
    description: 'AppCMS V10 — gztv5.com 数据源，m3u8 直链',
  },

  /**
   * 返回可用源列表。
   */
  async getSources(ctx) {
    return [
      { id: SOURCE_ID, name: SOURCE_NAME },
    ];
  },

  /**
   * 搜索影视资源。
   * @param {object} ctx  - MoonTV 脚本上下文
   * @param {object} opts - { keyword, page, sourceId }
   */
  async search(ctx, { keyword, page, sourceId }) {
    const sid = sourceId || SOURCE_ID;
    const pg = page || 1;
    ctx.log.info('[gztv] search', JSON.stringify({ keyword, page: pg, sourceId: sid }));

    const data = await apiGet({
      ac: 'videolist',
      wd: keyword,
      pg: String(pg),
      limit: '20',
    });

    if (!data || data.code !== 1 || !Array.isArray(data.list)) {
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

  /**
   * 获取推荐/首页影视列表。
   * 支持按分类筛选，默认为全部分类。
   * @param {object} ctx  - MoonTV 脚本上下文
   * @param {object} opts - { page, typeId, sourceId }
   */
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

    const data = await apiGet(params);

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

  /**
   * 获取影视详情及播放列表。
   * @param {object} ctx  - MoonTV 脚本上下文
   * @param {object} opts - { id, sourceId }
   */
  async detail(ctx, { id, sourceId }) {
    const sid = sourceId || SOURCE_ID;
    ctx.log.info('[gztv] detail', JSON.stringify({ id, sourceId: sid }));

    const data = await apiGet({
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

  /**
   * 解析播放地址。
   * gztv5 返回 m3u8 直链，直接返回即可，无需额外转换。
   * @param {object} ctx  - MoonTV 脚本上下文
   * @param {object} opts - { playUrl, sourceId, episodeIndex }
   */
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
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        Referer: 'https://gztv5.com/',
      },
    };
  },
};
