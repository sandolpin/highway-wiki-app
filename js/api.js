/* =========================================================
   api.js : Wikipedia (MediaWiki API) 通信 & マスターデータ取得
   ========================================================= */

const WikiAPI = (() => {
  const ENDPOINT = "https://ja.wikipedia.org/w/api.php";
  const CACHE_PREFIX = "hw_wiki_cache_v1_";

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
   * redirects=1 により「海老名SA」→「海老名サービスエリア」等も自動解決
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
    } catch (_) {
      // sessionStorage容量超過時は無視
    }

    return result;
  }

  return {
    fetchRoutesMaster,
    fetchPageHtml
  };
})();
