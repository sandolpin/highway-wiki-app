/* =========================================================
   api.js : Wikipedia (MediaWiki API) 通信 & マスターデータ取得
   ========================================================= */

const WikiAPI = (() => {
  const ENDPOINT = "https://ja.wikipedia.org/w/api.php";
  const CACHE_PREFIX = "hw_wiki_cache_v2_";
  const SUMMARY_PREFIX = "hw_wiki_sum_v2_";
  const pendingSummaries = new Map();

  /**
   * data/routes.json から路線マスター一覧を取得
   */
  async function fetchRoutesMaster() {
    try {
      const res = await fetch("data/routes.json");
      if (!res.ok) throw new Error("routes.json の読み込みに失敗しました");
      return await res.json();
    } catch (err) {
      console.error(err);
      return [];
    }
  }

  /**
   * 指定したWikipedia記事タイトルのHTML・セクション情報を取得
   */
  async function fetchPageHtml(pageTitle) {
    const cleanTitle = (pageTitle || "").trim();
    if (!cleanTitle) {
      throw new Error("記事タイトルが指定されていません。");
    }

    const cacheKey = CACHE_PREFIX + cleanTitle;
    const cached = sessionStorage.getItem(cacheKey);
    if (cached) {
      try {
        return JSON.parse(cached);
      } catch (_) {
        sessionStorage.removeItem(cacheKey);
      }
    }

    const params = new URLSearchParams({
      action: "parse",
      format: "json",
      origin: "*",
      redirects: "1",
      page: cleanTitle,
      prop: "text|sections|displaytitle"
    });

    const url = `${ENDPOINT}?${params.toString()}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Wikipedia API通信エラー (${response.status})`);
    }

    const data = await response.json();
    if (data.error) {
      throw new Error(`Wikipedia記事が見つかりませんでした: ${cleanTitle}`);
    }

    const result = {
      title: data.parse.title,
      pageid: data.parse.pageid,
      html: data.parse.text["*"],
      sections: data.parse.sections || [],
      wikiUrl: `https://ja.wikipedia.org/wiki/${encodeURIComponent(data.parse.title)}`
    };

    try {
      sessionStorage.setItem(cacheKey, JSON.stringify(result));
    } catch (_) {}

    return result;
  }

  /**
   * ホバープレビュー用：Wikipedia記事の冒頭要約（プレーンテキスト）を高速取得
   */
  async function fetchPageSummary(pageTitle) {
    const cleanTitle = (pageTitle || "").trim();
    if (!cleanTitle) return null;

    const cacheKey = SUMMARY_PREFIX + cleanTitle;
    const cached = sessionStorage.getItem(cacheKey);
    if (cached) {
      try {
        return JSON.parse(cached);
      } catch (_) {
        sessionStorage.removeItem(cacheKey);
      }
    }

    if (pendingSummaries.has(cleanTitle)) {
      return pendingSummaries.get(cleanTitle);
    }

    const promise = (async () => {
      try {
        const params = new URLSearchParams({
          action: "query",
          format: "json",
          origin: "*",
          redirects: "1",
          prop: "extracts",
          exintro: "1",
          explaintext: "1",
          exsentences: "3",
          titles: cleanTitle
        });

        const res = await fetch(`${ENDPOINT}?${params.toString()}`);
        if (!res.ok) return null;
        const data = await res.json();
        const pages = data?.query?.pages;
        if (!pages) return null;

        const pageObj = Object.values(pages)[0];
        if (!pageObj || pageObj.missing !== undefined) {
          const emptyRes = { title: cleanTitle, extract: "" };
          sessionStorage.setItem(cacheKey, JSON.stringify(emptyRes));
          return emptyRes;
        }

        const summary = {
          title: pageObj.title || cleanTitle,
          extract: (pageObj.extract || "").replace(/\s+/g, " ").trim()
        };
        try {
          sessionStorage.setItem(cacheKey, JSON.stringify(summary));
        } catch (_) {}
        return summary;
      } catch (_) {
        return null;
      } finally {
        pendingSummaries.delete(cleanTitle);
      }
    })();

    pendingSummaries.set(cleanTitle, promise);
    return promise;
  }

  return {
    fetchRoutesMaster,
    fetchPageHtml,
    fetchPageSummary
  };
})();
