/* =========================================================
   parser.js : Wikipedia HTML を解析して構造化データに変換
   ========================================================= */

const WikiParser = (() => {
  /**
   * 注釈番号 [1] や [注釈 1] をテキストから除去
   */
  function cleanText(str) {
    return (str || "")
      .replace(/\[\s*(?:注釈?|出典)?\s*\d+\s*\]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  /**
   * 編集リンクなどを除いた安全な原文HTMLを生成
   */
  function sanitizeRawHtml(doc) {
    const root = doc.querySelector(".mw-parser-output") || doc.body;
    const clone = root.cloneNode(true);
    clone.querySelectorAll(".mw-editsection, script, style, .navbox, .sistersitebox, .ambox").forEach(el => el.remove());
    // Wikipedia内部リンクを別タブのWikipedia本家URLに変換
    clone.querySelectorAll("a[href^='/wiki/']").forEach(a => {
      a.setAttribute("href", "https://ja.wikipedia.org" + a.getAttribute("href"));
      a.setAttribute("target", "_blank");
      a.setAttribute("rel", "noopener noreferrer");
    });
    return clone.innerHTML;
  }

  /**
   * 基礎情報ボックス (table.infobox) からキー・バリューを抽出
   */
  function extractInfobox(doc) {
    const rows = [];
    const infobox = doc.querySelector("table.infobox");
    if (!infobox) return rows;

    infobox.querySelectorAll("tr").forEach(tr => {
      const th = tr.querySelector("th");
      const td = tr.querySelector("td");
      if (th && td) {
        const key = cleanText(th.textContent);
        const val = cleanText(td.textContent);
        if (key && val && key.length < 25) {
          rows.push({ key, val });
        }
      }
    });
    return rows;
  }

  /**
   * 記事冒頭の概要段落を抽出
   */
  function extractLeadParagraphs(doc) {
    const root = doc.querySelector(".mw-parser-output") || doc.body;
    const paragraphs = [];
    for (const child of root.children) {
      if (child.tagName === "H2" || child.classList.contains("mw-heading2")) break;
      if (child.tagName === "P") {
        const text = cleanText(child.textContent);
        if (text.length > 15) {
          paragraphs.push(text);
        }
      }
    }
    return paragraphs.slice(0, 4);
  }

  /**
   * 見出しテキストに一致するセクション内の要素群を取得
   */
  function getElementsUnderHeading(doc, keywords, level = "H2") {
    const root = doc.querySelector(".mw-parser-output") || doc.body;
    const elements = [];
    let capturing = false;

    for (const child of root.children) {
      const isH2 = child.tagName === "H2" || child.classList.contains("mw-heading2");
      const isH3 = child.tagName === "H3" || child.classList.contains("mw-heading3");

      if (level === "H2" && isH2) {
        const hText = cleanText(child.textContent);
        if (keywords.some(kw => hText.includes(kw))) {
          capturing = true;
          continue;
        } else if (capturing) {
          break;
        }
      } else if (level === "H3" && (isH2 || isH3)) {
        if (isH2 && capturing) break;
        const hText = cleanText(child.textContent);
        if (isH3 && keywords.some(kw => hText.includes(kw))) {
          capturing = true;
          continue;
        } else if (isH3 && capturing) {
          break;
        }
      }

      if (capturing) {
        elements.push(child);
      }
    }
    return elements;
  }

  /**
   * 施設名文字列から種別バッジ配列（IC, JCT, SA, PA, SIC 等）と表示名を解析
   */
  function detectFacilityTypesAndName(rawName) {
    let text = cleanText(rawName);
    const types = [];

    // スマートIC判定
    if (/スマートIC|SIC/i.test(text)) {
      types.push("SIC");
    }
    // JCT判定
    if (/JCT|ジャンクション/i.test(text)) {
      types.push("JCT");
    }
    // IC判定（SICのみの場合は重複させない）
    if (/(?<![A-Z])IC|インターチェンジ/i.test(text) && !/スマートIC|SIC/i.test(text)) {
      types.push("IC");
    }
    // SA / PA判定
    if (/SA|サービスエリア/i.test(text)) {
      types.push("SA");
    }
    if (/PA|パーキングエリア/i.test(text)) {
      types.push("PA");
    }
    // 料金所・トンネル・バスストップ
    if (/TB|本線料金所|料金所/i.test(text)) {
      types.push("TB");
    }
    if (/TN|トンネル/i.test(text)) {
      types.push("TN");
    }

    if (types.length === 0) {
      types.push("IC");
    }

    // 表示用の短い施設名（例：「横浜青葉JCT/IC」→「横浜青葉」）
    let shortName = text
      .replace(/(スマートIC|SIC|JCT|ジャンクション|IC|インターチェンジ|SA|サービスエリア|PA|パーキングエリア|TB|本線料金所|料金所|TN|トンネル|BS|バスストップ)/gi, "")
      .replace(/[\/・／]+$/g, "")
      .replace(/^[\/・／]+/g, "")
      .trim();

    if (!shortName) shortName = text;

    return { types, shortName, fullName: text };
  }

  /**
   * 路線ページのHTML解析
   */
  function parseRoutePage(htmlString) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlString, "text/html");

    const overview = {
      paragraphs: extractLeadParagraphs(doc),
      infobox: extractInfobox(doc)
    };

    // 1. 「インターチェンジなど」の表を解析
    const icElements = getElementsUnderHeading(doc, ["インターチェンジなど", "出入口", "インターチェンジ一覧"], "H2");
    let interchanges = [];
    const icTable = icElements.map(el => el.tagName === "TABLE" ? el : el.querySelector("table.wikitable")).find(Boolean);

    if (icTable) {
      interchanges = parseInterchangeTable(icTable);
    }

    // 2. 「路線状況」の車線・最高速度とテキスト解説を解析
    const statusElements = getElementsUnderHeading(doc, ["路線状況"], "H2");
    const status = parseRouteStatus(statusElements);

    return {
      overview,
      interchanges,
      status,
      rawHtml: sanitizeRawHtml(doc)
    };
  }

  /**
   * Wikipediaの「インターチェンジなど」wikitable を解析
   */
  function parseInterchangeTable(table) {
    const rows = Array.from(table.querySelectorAll("tr"));
    if (rows.length < 2) return [];

    // ヘッダー列の位置を特定
    const headerCells = Array.from(rows[0].querySelectorAll("th, td")).map(c => cleanText(c.textContent));
    let idxNum = headerCells.findIndex(h => /番号/.test(h));
    let idxName = headerCells.findIndex(h => /施設名|名称|なまえ/.test(h));
    let idxConnect = headerCells.findIndex(h => /接続路線/.test(h));
    let idxKm = headerCells.findIndex(h => /キロ|距離|起点/.test(h));
    let idxNote = headerCells.findIndex(h => /備考/.test(h));

    // デフォルト列位置フォールバック（Wikipedia標準形式）
    if (idxNum === -1) idxNum = 0;
    if (idxName === -1) idxName = 1;
    if (idxConnect === -1) idxConnect = 2;
    if (idxKm === -1) idxKm = 3;
    if (idxNote === -1) idxNote = 4;

    const list = [];

    for (let i = 1; i < rows.length; i++) {
      const cells = Array.from(rows[i].querySelectorAll("th, td"));
      if (cells.length < 2) continue;

      // 県境行などのcolspan見出し行をスキップ
      const firstColspan = parseInt(cells[0].getAttribute("colspan") || "1", 10);
      if (firstColspan >= 4) continue;

      const numRaw = cleanText(cells[idxNum]?.textContent || "");
      const nameCell = cells[idxName];
      if (!nameCell) continue;

      const nameRaw = cleanText(nameCell.textContent);
      if (!nameRaw || nameRaw === "-" || nameRaw === "―") continue;

      // リンク先Wikipedia記事タイトルを取得
      const linkEl = nameCell.querySelector("a[title]");
      let wikiTarget = linkEl ? linkEl.getAttribute("title") : nameRaw;
      // 赤リンク等の注釈除去
      wikiTarget = wikiTarget.replace(/\s*\(存在しないページ\)/g, "").trim();

      const { types, shortName, fullName } = detectFacilityTypesAndName(nameRaw);

      // キロ程整形（数値のみなら km を付与）
      let kmRaw = cleanText(cells[idxKm]?.textContent || "");
      if (kmRaw && /^[0-9.]+$/.test(kmRaw)) {
        kmRaw = kmRaw + "km";
      } else if (kmRaw && /[0-9]/.test(kmRaw) && !/km/i.test(kmRaw)) {
        kmRaw = kmRaw.replace(/([0-9]+(?:\.[0-9]+)?)/g, "$1km");
      }

      const connectRaw = cleanText(cells[idxConnect]?.textContent || "");
      const noteRaw = cleanText(cells[idxNote]?.textContent || "");

      // 備考から「事業中」「建設中」「予定」などを優先抽出
      let shortNote = "";
      if (/事業中|建設中|予定|未開通/.test(noteRaw)) {
        const m = noteRaw.match(/(事業中|建設中|予定|未開通)/);
        shortNote = m ? m[1] : "";
      } else if (noteRaw.length > 0 && noteRaw.length <= 16) {
        shortNote = noteRaw;
      }

      list.push({
        num: numRaw === "-" || numRaw === "―" ? "-" : numRaw,
        types,
        shortName,
        fullName,
        wikiTitle: wikiTarget,
        km: kmRaw,
        note: shortNote,
        fullNote: noteRaw,
        connect: connectRaw === "-" || connectRaw === "―" ? "" : connectRaw
      });
    }

    return list;
  }

  /**
   * 路線状況（車線数・最高速度の表 ＋ サブセクション解説）を解析
   */
  function parseRouteStatus(elements) {
    const laneSpeedRows = [];
    const proseSections = [];

    // 表を探す
    const table = elements.map(el => el.tagName === "TABLE" ? el : el.querySelector("table.wikitable")).find(Boolean);
    if (table) {
      const trs = Array.from(table.querySelectorAll("tr"));
      let prevSpeedKey = "";

      for (let i = 1; i < trs.length; i++) {
        const tds = Array.from(trs[i].querySelectorAll("th, td"));
        if (tds.length < 2) continue;

        const sectionText = cleanText(tds[0]?.textContent || "");
        if (!sectionText || sectionText.includes("区間")) continue;

        // 車線数（例: "6 (3+3)" や "4 (2+2)" や "8 (4+4)" や "暫定2 (1+1)"）
        const laneCellText = cleanText(tds[1]?.textContent || "");
        let upLanes = 2;
        let downLanes = 2;
        const plusMatch = laneCellText.match(/(\d)\s*[\+＋]\s*(\d)/);
        if (plusMatch) {
          upLanes = parseInt(plusMatch[1], 10);
          downLanes = parseInt(plusMatch[2], 10);
        } else {
          const totalMatch = laneCellText.match(/(\d+)/);
          if (totalMatch) {
            const total = parseInt(totalMatch[1], 10);
            upLanes = Math.max(1, Math.floor(total / 2));
            downLanes = Math.max(1, Math.ceil(total / 2));
          }
        }

        // 最高速度セル（例: "大型90km/h / 普通100km/h" や "100km/h"）
        const speedCellText = cleanText(tds[2]?.textContent || "");
        const speeds = parseSpeedText(speedCellText);
        const speedKey = JSON.stringify(speeds);

        laneSpeedRows.push({
          section: sectionText,
          upLanes,
          downLanes,
          speeds: speedKey === prevSpeedKey ? [] : speeds
        });
        if (speeds.length > 0) {
          prevSpeedKey = speedKey;
        }
      }
    }

    // 見出しと段落を抽出（インターチェンジ、サービスエリア・パーキングエリア等）
    let currentSub = null;
    for (const el of elements) {
      const isH3 = el.tagName === "H3" || el.classList.contains("mw-heading3");
      if (isH3) {
        if (currentSub && currentSub.paragraphs.length > 0) {
          proseSections.push(currentSub);
        }
        currentSub = {
          title: cleanText(el.textContent),
          paragraphs: []
        };
      } else if (el.tagName === "P" && currentSub) {
        const txt = cleanText(el.textContent);
        if (txt.length > 10) {
          currentSub.paragraphs.push(txt);
        }
      }
    }
    if (currentSub && currentSub.paragraphs.length > 0) {
      proseSections.push(currentSub);
    }

    return { laneSpeedRows, proseSections };
  }

  /**
   * 最高速度テキストから標識データ配列を生成
   */
  function parseSpeedText(text) {
    if (!text) return [];
    const results = [];

    // パターン1: 大型・大型貨物・左記以外（または普通車）
    const largeMatch = text.match(/大型[^0-9]{0,6}(\d{2,3})/);
    const cargoMatch = text.match(/(?:大型貨物|特定中型)[^0-9]{0,6}(\d{2,3})/);
    const otherMatch = text.match(/(?:左記以外|普通|小型|その他)[^0-9]{0,6}(\d{2,3})/);

    if (largeMatch || cargoMatch || otherMatch) {
      if (largeMatch) results.push({ label: "大型", speed: largeMatch[1] });
      if (cargoMatch) results.push({ label: "大型貨物", speed: cargoMatch[1] });
      if (otherMatch) results.push({ label: "左記以外", speed: otherMatch[1] });
      return results;
    }

    // パターン2: 単一の速度表記（例: "100km/h", "80km/h"）
    const singleMatch = text.match(/(\d{2,3})\s*km/i) || text.match(/(\d{2,3})/);
    if (singleMatch) {
      results.push({ label: "最高速度", speed: singleMatch[1] });
    }
    return results;
  }

  /**
   * 施設詳細ページ（PA/SA および IC/JCT）のHTML解析
   */
  function parseFacilityPage(htmlString, isSapa) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlString, "text/html");

    const overview = {
      paragraphs: extractLeadParagraphs(doc),
      infobox: extractInfobox(doc)
    };

    const rawHtml = sanitizeRawHtml(doc);

    if (isSapa) {
      const sapaDirections = parseSapaFacilities(doc);
      return {
        isSapa: true,
        overview,
        sapaDirections,
        rawHtml
      };
    } else {
      const icDetail = parseIcJctDetail(doc);
      return {
        isSapa: false,
        overview,
        icDetail,
        rawHtml
      };
    }
  }

  /**
   * SA/PA記事の「施設」セクションを方面別に解析（画像3準拠）
   */
  function parseSapaFacilities(doc) {
    const facilityElems = getElementsUnderHeading(doc, ["施設"], "H2");
    const directions = [];
    let currentDir = null;

    const pushCurrent = () => {
      if (currentDir) {
        directions.push(currentDir);
      }
    };

    for (const el of facilityElems) {
      const isH3 = el.tagName === "H3" || el.classList.contains("mw-heading3");
      if (isH3) {
        pushCurrent();
        currentDir = {
          title: cleanText(el.textContent),
          largeParking: null,
          smallParking: null,
          hasToilet: false,
          hasEv: false,
          hasGs: false,
          hasInfo: false,
          categories: [],
          others: []
        };
        continue;
      }

      if (!currentDir) {
        // H3見出しなしでいきなり箇条書きが始まるPA/SA用
        currentDir = {
          title: "施設一覧",
          largeParking: null,
          smallParking: null,
          hasToilet: false,
          hasEv: false,
          hasGs: false,
          hasInfo: false,
          categories: [],
          others: []
        };
      }

      if (el.tagName === "UL") {
        parseSapaListItems(el, currentDir);
      }
    }
    pushCurrent();

    // 空のデフォルトブロックを除外
    return directions.filter(d =>
      d.largeParking || d.smallParking || d.hasToilet || d.hasEv || d.hasGs ||
      d.categories.length > 0 || d.others.length > 0
    );
  }

  function parseSapaListItems(ul, dirObj) {
    const topLis = Array.from(ul.children).filter(c => c.tagName === "LI");

    for (const li of topLis) {
      const nestedUl = li.querySelector("ul");
      // 親LIのテキスト（子ULを除く）
      const cloneLi = li.cloneNode(true);
      cloneLi.querySelectorAll("ul").forEach(u => u.remove());
      const lineText = cleanText(cloneLi.textContent);

      // 駐車場台数抽出
      if (/駐車場/.test(lineText)) {
        const largeM = lineText.match(/大型\s*([0-9,]+)\s*台/);
        const smallM = lineText.match(/小型\s*([0-9,]+)\s*台/);
        if (largeM) dirObj.largeParking = largeM[1] + "台";
        if (smallM) dirObj.smallParking = smallM[1] + "台";
        continue;
      }

      // トイレ・EV・ガソリンスタンド・インフォメーション判定
      if (/トイレ/.test(lineText)) {
        dirObj.hasToilet = true;
        continue;
      }
      if (/EV|電気自動車|急速充電/.test(lineText)) {
        dirObj.hasEv = true;
        continue;
      }
      if (/ガソリンスタンド|給油所|ENEOS|出光|コスモ|シェル/.test(lineText)) {
        dirObj.hasGs = true;
        continue;
      }
      if (/インフォメーション|案内所|コンシェルジュ/.test(lineText)) {
        dirObj.hasInfo = true;
        continue;
      }

      // 店舗カテゴリ判定
      const catType = detectShopCategory(lineText);
      const is24h = /24時間/.test(lineText);

      if (catType !== "other" || nestedUl) {
        const subItems = [];
        if (nestedUl) {
          nestedUl.querySelectorAll("li").forEach(subLi => {
            const subTxt = cleanText(subLi.textContent);
            if (subTxt) subItems.push(subTxt);
          });
        }
        dirObj.categories.push({
          catType,
          title: lineText,
          is24h,
          items: subItems
        });
      } else if (lineText) {
        dirObj.others.push(lineText);
      }
    }
  }

  function detectShopCategory(text) {
    if (/テイクアウト|ベーカリー|軽食/.test(text)) return "takeout";
    if (/フードコート|スナック/.test(text)) return "foodcourt";
    if (/ショッピング|お土産|売店/.test(text)) return "shopping";
    if (/カフェ|喫茶|スターバックス|タリーズ/.test(text)) return "cafe";
    if (/レストラン|食堂/.test(text)) return "restaurant";
    if (/コンビニ|セブン|ローソン|ファミリーマート/.test(text)) return "convenience";
    return "other";
  }

  /**
   * IC / JCT 記事の「接続する道路」「歴史」「周辺」を解析
   */
  function parseIcJctDetail(doc) {
    const roadElems = getElementsUnderHeading(doc, ["接続する道路", "接続道路"], "H2");
    const connectedRoads = [];

    roadElems.forEach(el => {
      if (el.tagName === "UL") {
        el.querySelectorAll("li").forEach(li => {
          const text = cleanText(li.textContent);
          if (!text) return;

          // 国道番号抽出
          const natMatch = text.match(/国道(\d+)号/);
          // 都道府県道番号抽出
          const prefMatch = text.match(/(?:都|道|府|県)道(\d+)号/);
          // 高速道路名抽出
          const hwMatch = text.match(/(E\d+[A-Z]?|C\d+)\s*([^（(\s]+)/);

          if (natMatch) {
            connectedRoads.push({ kind: "national", num: natMatch[1], name: text });
          } else if (prefMatch) {
            connectedRoads.push({ kind: "pref", num: prefMatch[1], name: text });
          } else if (hwMatch || /高速道路|自動車道|首都高速|阪神高速/.test(text)) {
            connectedRoads.push({ kind: "highway", num: hwMatch ? hwMatch[1] : "HW", name: text });
          } else {
            connectedRoads.push({ kind: "general", num: "", name: text });
          }
        });
      }
    });

    const historyElems = getElementsUnderHeading(doc, ["歴史", "沿革"], "H2");
    const historyItems = [];
    historyElems.forEach(el => {
      if (el.tagName === "UL") {
        el.querySelectorAll("li").forEach(li => {
          const t = cleanText(li.textContent);
          if (t) historyItems.push(t);
        });
      }
    });

    return {
      connectedRoads,
      historyItems: historyItems.slice(0, 10)
    };
  }

  return {
    parseRoutePage,
    parseFacilityPage
  };
})();
