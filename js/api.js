/* =========================================================
   api.js : routes.json 読み込み & Wikipedia API 通信
   ========================================================= */

const WikiAPI = (() => {
  const summaryCache = new Map();
  const pageHtmlCache = new Map();
  let routesMasterCache = null;

  // data/routes.json の読み込み失敗・構文エラー時に使用するフォールバックデータ
  const FALLBACK_ROUTES = [
    {
      id: "E1",
      number: "E1",
      name: "東名高速道路",
      kana: "とうめいこうそくどうろ とうめい",
      romaji: "tomei toumei",
      wikiTitle: "東名高速道路",
      region: "kanto-chubu",
      regionLabel: "関東・中部",
      operator: "NEXCO中日本",
      section: "東京IC 〜 小牧IC",
      length: "346.7 km",
      color: "#1b7837",
      mapCoords: [[310, 295], [275, 310], [235, 305]]
    },
    {
      id: "E1A-shintomei",
      number: "E1A",
      name: "新東名高速道路",
      kana: "しんとうめいこうそくどうろ しんとうめい",
      romaji: "shintomei",
      wikiTitle: "新東名高速道路",
      region: "kanto-chubu",
      regionLabel: "関東・中部",
      operator: "NEXCO中日本",
      section: "海老名南JCT 〜 豊田東JCT",
      length: "253.2 km",
      color: "#1b7837",
      mapCoords: [[302, 298], [270, 303], [242, 302]]
    },
    {
      id: "E1-meishin",
      number: "E1",
      name: "名神高速道路",
      kana: "めいしんこうそくどうろ めいしん",
      romaji: "meishin",
      wikiTitle: "名神高速道路",
      region: "chubu-kinki",
      regionLabel: "中部・近畿",
      operator: "NEXCO中日本・NEXCO西日本",
      section: "小牧IC 〜 西宮IC",
      length: "189.3 km",
      color: "#1b7837",
      mapCoords: [[235, 305], [212, 305], [188, 316]]
    },
    {
      id: "E2",
      number: "E2",
      name: "山陽自動車道",
      kana: "さんようじどうしゃどう さんよう",
      romaji: "sanyo",
      wikiTitle: "山陽自動車道",
      region: "kinki-chugoku",
      regionLabel: "近畿・中国",
      operator: "NEXCO西日本",
      section: "神戸JCT 〜 山口JCT",
      length: "418.7 km",
      color: "#1b7837",
      mapCoords: [[185, 314], [145, 310], [102, 322]]
    },
    {
      id: "E3",
      number: "E3",
      name: "九州自動車道",
      kana: "きゅうしゅうじどうしゃどう きゅうしゅう",
      romaji: "kyushu",
      wikiTitle: "九州自動車道",
      region: "kyushu",
      regionLabel: "九州",
      operator: "NEXCO西日本",
      section: "門司IC 〜 鹿児島IC",
      length: "346.2 km",
      color: "#1b7837",
      mapCoords: [[92, 330], [76, 365], [68, 410]]
    },
    {
      id: "E4",
      number: "E4",
      name: "東北自動車道",
      kana: "とうほくじどうしゃどう とうほく",
      romaji: "tohoku",
      wikiTitle: "東北自動車道",
      region: "kanto-tohoku",
      regionLabel: "関東・東北",
      operator: "NEXCO東日本",
      section: "川口JCT 〜 青森IC",
      length: "679.5 km",
      color: "#1b7837",
      mapCoords: [[314, 286], [330, 215], [336, 130]]
    },
    {
      id: "E5",
      number: "E5",
      name: "道央自動車道",
      kana: "どうおうじどうしゃどう どうおう",
      romaji: "doo hokkaido",
      wikiTitle: "道央自動車道",
      region: "hokkaido",
      regionLabel: "北海道",
      operator: "NEXCO東日本",
      section: "大沼公園IC 〜 士別剣淵IC",
      length: "451.7 km",
      color: "#1b7837",
      mapCoords: [[345, 98], [368, 72], [385, 45]]
    },
    {
      id: "E17",
      number: "E17",
      name: "関越自動車道",
      kana: "かんえつじどうしゃどう かんえつ",
      romaji: "kanetsu",
      wikiTitle: "関越自動車道",
      region: "kanto-chubu",
      regionLabel: "関東・甲信越",
      operator: "NEXCO東日本",
      section: "練馬IC 〜 長岡JCT",
      length: "246.3 km",
      color: "#1b7837",
      mapCoords: [[310, 288], [298, 260], [285, 228]]
    },
    {
      id: "E19-E20",
      number: "E20",
      name: "中央自動車道",
      kana: "ちゅうおうじどうしゃどう ちゅうおう",
      romaji: "chuo",
      wikiTitle: "中央自動車道",
      region: "kanto-chubu",
      regionLabel: "関東・中部",
      operator: "NEXCO中日本",
      section: "高井戸IC 〜 小牧JCT",
      length: "344.9 km",
      color: "#1b7837",
      mapCoords: [[308, 292], [275, 285], [235, 305]]
    },
    {
      id: "C1",
      number: "C1",
      name: "首都高速都心環状線",
      kana: "しゅとこうそくとしんかんじょうせん としんかんじょう",
      romaji: "shutoko c1",
      wikiTitle: "首都高速都心環状線",
      region: "kanto",
      regionLabel: "関東",
      operator: "首都高速道路",
      section: "江戸橋JCT 〜 浜崎橋JCT 〜 江戸橋JCT",
      length: "14.8 km",
      color: "#0068b7",
      mapCoords: [[313, 293], [316, 293], [316, 296], [313, 296], [313, 293]]
    }
  ];

  /**
   * 路線マスターデータ (data/routes.json) を取得
   */
  async function fetchRoutesMaster() {
    if (routesMasterCache) return routesMasterCache;
    try {
      const res = await fetch(`data/routes.json?v=${Date.now()}`);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();
      if (!Array.isArray(data) || data.length === 0) {
        throw new Error("routes.json の配列が空または不正です");
      }
      routesMasterCache = data;
      return data;
    } catch (err) {
      console.error("data/routes.json の読み込みに失敗したためフォールバックデータを使用します:", err);
      routesMasterCache = FALLBACK_ROUTES;
      return FALLBACK_ROUTES;
    }
  }

  /**
   * Wikipedia記事の本文HTMLを取得（リダイレクト自動追従）
   */
  async function fetchPageHtml(pageTitle) {
    const key = String(pageTitle || "").trim();
    if (!key) throw new Error("記事タイトルが指定されていません");
    if (pageHtmlCache.has(key)) return pageHtmlCache.get(key);

    const url = `https://ja.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(key)}&prop=text|displaytitle&redirects=1&format=json&origin=*`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Wikipedia API通信エラー (${res.status})`);
    }
    const json = await res.json();
    if (json.error || !json.parse || !json.parse.text) {
      throw new Error(json.error ? json.error.info : `記事「${key}」が見つかりません`);
    }

    const resolvedTitle = json.parse.title || key;
    const result = {
      title: resolvedTitle,
      html: json.parse.text["*"] || "",
      wikiUrl: `https://ja.wikipedia.org/wiki/${encodeURIComponent(resolvedTitle)}`
    };
    pageHtmlCache.set(key, result);
    return result;
  }

  /**
   * ホバープレビュー用のWikipedia要約文を取得
   */
  async function fetchPageSummary(pageTitle) {
    const key = String(pageTitle || "").trim();
    if (!key) return null;
    if (summaryCache.has(key)) return summaryCache.get(key);

    try {
      const url = `https://ja.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(key)}?redirect=true`;
      const res = await fetch(url);
      if (!res.ok) {
        summaryCache.set(key, null);
        return null;
      }
      const json = await res.json();
      const data = {
        title: json.title || key,
        extract: json.extract || ""
      };
      summaryCache.set(key, data);
      return data;
    } catch (_) {
      summaryCache.set(key, null);
      return null;
    }
  }

  return {
    fetchRoutesMaster,
    fetchPageHtml,
    fetchPageSummary
  };
})();
