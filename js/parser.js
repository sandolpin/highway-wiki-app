/* =========================================================
   parser.js : Wikipedia HTML を解析して構造化データに変換
   ========================================================= */

const WikiParser = (() => {
  /**
   * 注釈番号 [1] や [注釈 1] をテキストから除去
   */
  function cleanText(str) {
    return (str || "")
      .replace(/\[\s*(?:注釈?|出典|要出典|リンク切れ)?\s*\d*\s*\]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  /**
   * 見出し要素から [編集 | ソースを編集] を完全除去してテキスト取得
   */
  function cleanHeadingText(el) {
    if (!el) return "";
    const clone = el.cloneNode(true);
    clone.querySelectorAll(".mw-editsection, .mw-editsection-bracket, script, style").forEach(n => n.remove());
    return cleanText(clone.textContent);
  }

  /**
   * 編集リンクなどを除いた安全な原文HTMLを生成
   */
  function sanitizeRawHtml(doc) {
    const root = doc.querySelector(".mw-parser-output") || doc.body;
    const clone = root.cloneNode(true);
    clone.querySelectorAll(".mw-editsection, script, style, .navbox, .sistersitebox, .ambox").forEach(el => el.remove());
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
        const hText = cleanHeadingText(child);
        if (keywords.some(kw => hText.includes(kw))) {
          capturing = true;
          continue;
        } else if (capturing) {
          break;
        }
      } else if (level === "H3" && (isH2 || isH3)) {
        if (isH2 && capturing) break;
        const hText = cleanHeadingText(child);
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
   * HTMLテーブルの rowspan / colspan を展開し、2次元グリッド配列に変換
   * これにより結合セルがあっても列番号が絶対にズレない
   */
  function expandTableToGrid(table) {
    const trs = Array.from(table.querySelectorAll("tr"));
    const grid = [];

    for (let r = 0; r < trs.length; r++) {
      if (!grid[r]) grid[r] = [];
      const cells = Array.from(trs[r].querySelectorAll("th, td"));
      let colPtr = 0;

      for (const cell of cells) {
        while (grid[r][colPtr] !== undefined) {
          colPtr++;
        }
        const rowspan = Math.max(1, parseInt(cell.getAttribute("rowspan") || "1", 10));
        const colspan = Math.max(1, parseInt(cell.getAttribute("colspan") || "1", 10));

        for (let dr = 0; dr < rowspan; dr++) {
          for (let dc = 0; dc < colspan; dc++) {
            if (!grid[r + dr]) grid[r + dr] = [];
            grid[r + dr][colPtr + dc] = {
              cell,
              isOrigin: dr === 0 && dc === 0,
              rowspan,
              colspan
            };
          }
        }
        colPtr += colspan;
      }
    }
    return grid;
  }

  /**
   * テキストから施設種別配列を判定（BSを独立判定しIC誤爆を防ぐ）
   */
  function detectTypesFromText(rawText) {
    const text = cleanText(rawText);
    const types = [];

    if (/スマートIC|SIC/i.test(text)) {
      types.push("SIC");
    }
    if (/JCT|ジャンクション/i.test(text)) {
      types.push("JCT");
    }
    // 「スマートIC」「SIC」を除いた文字列に IC / インターチェンジ があるか判定
    const textWithoutSic = text.replace(/スマートIC|SIC/gi, "");
    if (/(?<![A-Z])IC|インターチェンジ/i.test(textWithoutSic)) {
      types.push("IC");
    }
    if (/SA|サービスエリア/i.test(text)) {
      types.push("SA");
    }
    if (/PA|パーキングエリア/i.test(text)) {
      types.push("PA");
    }
    if (/BS|バスストップ|バス停留所/i.test(text)) {
      types.push("BS");
    }
    if (/TB|本線料金所|料金所/i.test(text)) {
      types.push("TB");
    }
    if (/TN|トンネル/i.test(text)) {
      types.push("TN");
    }

    return types;
  }

  /**
   * 施設名セルから表示名・種別・個別リンク（PAとIC併設時の個別遷移先）を解析
   */
  function parseFacilityCell(nameCell) {
    const rawName = cleanText(nameCell.textContent);
    let types = detectTypesFromText(rawName);
    if (types.length === 0) {
      types = ["IC"];
    }

    // セル内の全Wikipediaリンクを走査し、種別ごとの遷移先記事を特定
    const anchors = Array.from(nameCell.querySelectorAll("a[title]")).filter(a => {
      const href = a.getAttribute("href") || "";
      return !href.startsWith("#");
    });

    const linkInfos = anchors.map(a => {
      const linkText = cleanText(a.textContent);
      const titleAttr = (a.getAttribute("title") || "").replace(/\s*\(存在しないページ\)/g, "").trim();
      const detected = detectTypesFromText(linkText + " " + titleAttr);
      return {
        text: linkText,
        wikiTitle: titleAttr || linkText,
        types: detected
      };
    });

    const defaultWiki = linkInfos.length > 0 ? linkInfos[0].wikiTitle : rawName;

    // 各バッジ種別ごとに最適なリンク先Wikipedia記事を割り当て
    const badgeItems = types.map(t => {
      // 該当種別を持つリンクを探す
      const exactMatch = linkInfos.find(info => info.types.includes(t));
      if (exactMatch) {
        return {
          type: t,
          wikiTitle: exactMatch.wikiTitle,
          label: exactMatch.text || exactMatch.wikiTitle
        };
      }
      // リンクが1つしかなく併設（例：〇〇PAにスマートIC併設でスマートIC側の記事名が推測できる場合）
      const baseName = rawName
        .replace(/(スマートIC|SIC|JCT|ジャンクション|IC|インターチェンジ|SA|サービスエリア|PA|パーキングエリア|TB|本線料金所|料金所|TN|トンネル|BS|バスストップ|バス停留所)/gi, "")
        .replace(/[\/・／（）()]+/g, "")
        .trim();

      if (t === "PA" && baseName) {
        return { type: "PA", wikiTitle: `${baseName}パーキングエリア`, label: `${baseName}PA` };
      }
      if (t === "SA" && baseName) {
        return { type: "SA", wikiTitle: `${baseName}サービスエリア`, label: `${baseName}SA` };
      }
      if (t === "SIC" && baseName) {
        return { type: "SIC", wikiTitle: `${baseName}スマートインターチェンジ`, label: `${baseName}SIC` };
      }
      if (t === "IC" && baseName) {
        return { type: "IC", wikiTitle: `${baseName}インターチェンジ`, label: `${baseName}IC` };
      }
      if (t === "JCT" && baseName) {
        return { type: "JCT", wikiTitle: `${baseName}ジャンクション`, label: `${baseName}JCT` };
      }
      return {
        type: t,
        wikiTitle: defaultWiki,
        label: rawName
      };
    });

    // 表示用の短い施設名（例：「横浜青葉JCT/IC」→「横浜青葉」）
    let shortName = rawName
      .replace(/(スマートIC|SIC|JCT|ジャンクション|IC|インターチェンジ|SA|サービスエリア|PA|パーキングエリア|TB|本線料金所|料金所|TN|トンネル|BS|バスストップ|バス停留所)/gi, "")
      .replace(/[\/・／]+$/g, "")
      .replace(/^[\/・／]+/g, "")
      .replace(/\s*[\/・／]\s*/g, "・")
      .trim();

    if (!shortName) shortName = rawName;

    return {
      types,
      badgeItems,
      shortName,
      fullName: rawName,
      wikiTitle: defaultWiki
    };
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

    const icElements = getElementsUnderHeading(doc, ["インターチェンジなど", "出入口", "インターチェンジ一覧"], "H2");
    let interchanges = [];
    const icTable = icElements.map(el => el.tagName === "TABLE" ? el : el.querySelector("table.wikitable")).find(Boolean);

    if (icTable) {
      interchanges = parseInterchangeTable(icTable);
    }

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
   * Wikipediaの「インターチェンジなど」wikitable をグリッド展開して正確に解析
   */
  function parseInterchangeTable(table) {
    const grid = expandTableToGrid(table);
    if (grid.length < 2) return [];

    // ヘッダー行（最初の行）から列インデックスを特定
    const headerRow = grid[0] || [];
    const headerTexts = headerRow.map(slot => slot ? cleanText(slot.cell.textContent) : "");

    let idxNum = headerTexts.findIndex(h => /番号/.test(h));
    let idxName = headerTexts.findIndex(h => /施設名|名称|なまえ/.test(h));
    let idxConnect = headerTexts.findIndex(h => /接続路線/.test(h));
    let idxKm = headerTexts.findIndex(h => /キロ|距離|起点/.test(h));
    let idxNote = headerTexts.findIndex(h => /備考/.test(h));

    if (idxNum === -1) idxNum = 0;
    if (idxName === -1) idxName = 1;
    if (idxConnect === -1) idxConnect = 2;
    if (idxKm === -1) idxKm = 3;
    if (idxNote === -1) idxNote = 4;

    const list = [];

    for (let r = 1; r < grid.length; r++) {
      const row = grid[r];
      if (!row || row.length < 2) continue;

      // 県境行など、1つのセルが横4列以上にまたがる見出し行はスキップ
      if (row[0] && row[0].colspan >= 4) continue;

      const nameSlot = row[idxName];
      if (!nameSlot || !nameSlot.cell) continue;

      // 施設名セル自体が前の行からのrowspan継続であり、かつ備考等だけの補足行である場合はスキップ
      if (!nameSlot.isOrigin) continue;

      const parsedFacility = parseFacilityCell(nameSlot.cell);
      if (!parsedFacility.fullName || parsedFacility.fullName === "-" || parsedFacility.fullName === "―") {
        continue;
      }

      const numRaw = row[idxNum] ? cleanText(row[idxNum].cell.textContent) : "-";
      // IC番号欄に万が一長文が入っている場合は "-" に正規化
      const safeNum = (numRaw === "-" || numRaw === "―" || numRaw.length > 10) ? "-" : numRaw;

      // キロ程整形
      let kmRaw = row[idxKm] ? cleanText(row[idxKm].cell.textContent) : "";
      if (kmRaw === "-" || kmRaw === "―") {
        kmRaw = "";
      } else if (kmRaw && /^[0-9.]+$/.test(kmRaw)) {
        kmRaw = kmRaw + "km";
      } else if (kmRaw && /[0-9]/.test(kmRaw) && !/km/i.test(kmRaw)) {
        kmRaw = kmRaw.replace(/([0-9]+(?:\.[0-9]+)?)/g, "$1km");
      }

      const connectRaw = row[idxConnect] ? cleanText(row[idxConnect].cell.textContent) : "";
      const noteRaw = row[idxNote] ? cleanText(row[idxNote].cell.textContent) : "";

      let shortNote = "";
      if (/事業中|建設中|予定|未開通/.test(noteRaw)) {
        const m = noteRaw.match(/(事業中|建設中|予定|未開通)/);
        shortNote = m ? m[1] : "";
      } else if (noteRaw.length > 0 && noteRaw.length <= 16 && noteRaw !== "-" && noteRaw !== "―") {
        shortNote = noteRaw;
      }

      list.push({
        num: safeNum,
        types: parsedFacility.types,
        badgeItems: parsedFacility.badgeItems,
        shortName: parsedFacility.shortName,
        fullName: parsedFacility.fullName,
        wikiTitle: parsedFacility.wikiTitle,
        km: kmRaw,
        note: shortNote,
        fullNote: (noteRaw === "-" || noteRaw === "―") ? "" : noteRaw,
        connect: (connectRaw === "-" || connectRaw === "―") ? "" : connectRaw
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

    const table = elements.map(el => el.tagName === "TABLE" ? el : el.querySelector("table.wikitable")).find(Boolean);
    if (table) {
      const grid = expandTableToGrid(table);
      let prevSpeedKey = "";

      for (let r = 1; r < grid.length; r++) {
        const row = grid[r];
        if (!row || row.length < 2) continue;

        const sectionText = row[0] ? cleanText(row[0].cell.textContent) : "";
        if (!sectionText || sectionText.includes("区間")) continue;

        const laneCellText = row[1] ? cleanText(row[1].cell.textContent) : "";
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

        const speedCellText = row[2] ? cleanText(row[2].cell.textContent) : "";
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

    let currentSub = null;
    for (const el of elements) {
      const isH3 = el.tagName === "H3" || el.classList.contains("mw-heading3");
      if (isH3) {
        if (currentSub && currentSub.paragraphs.length > 0) {
          proseSections.push(currentSub);
        }
        currentSub = {
          title: cleanHeadingText(el),
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

    const largeMatch = text.match(/大型[^0-9]{0,6}(\d{2,3})/);
    const cargoMatch = text.match(/(?:大型貨物|特定中型)[^0-9]{0,6}(\d{2,3})/);
    const otherMatch = text.match(/(?:左記以外|普通|小型|その他)[^0-9]{0,6}(\d{2,3})/);

    if (largeMatch || cargoMatch || otherMatch) {
      if (largeMatch) results.push({ label: "大型", speed: largeMatch[1] });
      if (cargoMatch) results.push({ label: "大型貨物", speed: cargoMatch[1] });
      if (otherMatch) results.push({ label: "左記以外", speed: otherMatch[1] });
      return results;
    }

    const singleMatch = text.match(/(\d{2,3})\s*km/i) || text.match(/(\d{2,3})/);
    if (singleMatch) {
      results.push({ label: "最高速度", speed: singleMatch[1] });
    }
    return results;
  }

  /**
   * 施設詳細ページ（PA/SA および IC/JCT/BS）のHTML解析
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
   * SA/PA記事の「施設」セクションを方面別に解析（[編集]除去・ネスト駐車場台数・表形式対応）
   */
  function parseSapaFacilities(doc) {
    const facilityElems = getElementsUnderHeading(doc, ["施設"], "H2");
    const directions = [];
    let currentDir = null;

    const createDir = (title) => ({
      title,
      largeParking: null,
      smallParking: null,
      hasToilet: false,
      hasEv: false,
      hasGs: false,
      hasInfo: false,
      hasVending: false,
      categories: [],
      others: []
    });

    const pushCurrent = () => {
      if (currentDir) {
        directions.push(currentDir);
      }
    };

    for (const el of facilityElems) {
      const isHeading =
        el.tagName === "H3" ||
        el.tagName === "H4" ||
        el.classList.contains("mw-heading3") ||
        el.classList.contains("mw-heading4");

      if (isHeading) {
        pushCurrent();
        currentDir = createDir(cleanHeadingText(el));
        continue;
      }

      if (!currentDir) {
        currentDir = createDir("施設一覧");
      }

      if (el.tagName === "UL") {
        parseSapaListItems(el, currentDir);
      } else if (el.tagName === "TABLE") {
        // テーブル形式で上下線・設備が書かれているPA/SA記事への対応
        parseSapaTable(el, currentDir);
      }
    }
    pushCurrent();

    return directions.filter(d =>
      d.largeParking || d.smallParking || d.hasToilet || d.hasEv || d.hasGs || d.hasInfo || d.hasVending ||
      d.categories.length > 0 || d.others.length > 0
    );
  }

  function parseSapaListItems(ul, dirObj) {
    const topLis = Array.from(ul.children).filter(c => c.tagName === "LI");

    for (const li of topLis) {
      const nestedUl = li.querySelector("ul");
      const cloneLi = li.cloneNode(true);
      cloneLi.querySelectorAll("ul").forEach(u => u.remove());
      const lineText = cleanText(cloneLi.textContent);

      // 子ULのテキストも結合して駐車台数や設備を漏らさずチェック
      const subTexts = nestedUl
        ? Array.from(nestedUl.querySelectorAll("li")).map(s => cleanText(s.textContent)).filter(Boolean)
        : [];
      const combinedText = [lineText, ...subTexts].join(" ");

      // 1. 駐車場台数抽出（親LI・子ULどちらに書かれていても取得）
      if (/駐車場/.test(lineText)) {
        const largeM = combinedText.match(/大型[^0-9]{0,5}([0-9,]+)\s*台/);
        const smallM = combinedText.match(/小型[^0-9]{0,5}([0-9,]+)\s*台/);
        if (largeM) dirObj.largeParking = largeM[1] + "台";
        if (smallM) dirObj.smallParking = smallM[1] + "台";
        // 駐車台数が取れなかった場合のみその他へ
        if (!largeM && !smallM && subTexts.length > 0) {
          dirObj.others.push(`駐車場（${subTexts.join(" / ")}）`);
        }
        continue;
      }

      // 2. トイレ・EV・ガソリンスタンド・案内所・自販機判定
      if (/^トイレ|お手洗い/.test(lineText)) {
        dirObj.hasToilet = true;
        continue;
      }
      if (/EV|電気自動車|急速充電/.test(lineText)) {
        dirObj.hasEv = true;
        continue;
      }
      if (/ガソリンスタンド|給油所|ENEOS|出光|コスモ|シェル|apollostation/.test(lineText)) {
        dirObj.hasGs = true;
        continue;
      }
      if (/インフォメーション|案内所|コンシェルジュ|ハイウェイ情報/.test(lineText)) {
        dirObj.hasInfo = true;
        continue;
      }
      if (/自動販売機/.test(lineText)) {
        dirObj.hasVending = true;
        continue;
      }

      // 3. 店舗カテゴリ判定
      const catType = detectShopCategory(lineText);
      const is24h = /24時間/.test(combinedText);

      if (catType !== "other" || subTexts.length > 0) {
        dirObj.categories.push({
          catType,
          title: lineText,
          is24h,
          items: subTexts
        });
      } else if (lineText) {
        dirObj.others.push(lineText);
      }
    }
  }

  function parseSapaTable(table, dirObj) {
    table.querySelectorAll("tr").forEach(tr => {
      const cells = Array.from(tr.querySelectorAll("th, td")).map(c => cleanText(c.textContent));
      if (cells.length < 2) return;
      const label = cells[0];
      const val = cells.slice(1).join(" / ");
      if (!label || !val) return;

      if (/駐車場/.test(label)) {
        const largeM = val.match(/大型[^0-9]{0,5}([0-9,]+)\s*台/);
        const smallM = val.match(/小型[^0-9]{0,5}([0-9,]+)\s*台/);
        if (largeM && !dirObj.largeParking) dirObj.largeParking = largeM[1] + "台";
        if (smallM && !dirObj.smallParking) dirObj.smallParking = smallM[1] + "台";
      } else if (/トイレ/.test(label)) {
        dirObj.hasToilet = true;
      } else if (/給油|ガソリン/.test(label)) {
        dirObj.hasGs = true;
      } else if (/充電|EV/.test(label)) {
        dirObj.hasEv = true;
      } else {
        dirObj.others.push(`${label}：${val}`);
      }
    });
  }

  function detectShopCategory(text) {
    if (/テイクアウト|ベーカリー|軽食/.test(text)) return "takeout";
    if (/フードコート|スナック/.test(text)) return "foodcourt";
    if (/ショッピング|お土産|売店/.test(text)) return "shopping";
    if (/カフェ|喫茶|スターバックス|タリーズ/.test(text)) return "cafe";
    if (/レストラン|食堂/.test(text)) return "restaurant";
    if (/コンビニ|セブン|ローソン|ファミリーマート|デイリーヤマザキ/.test(text)) return "convenience";
    return "other";
  }

  /**
   * IC / JCT / BS 記事の「接続する道路」「歴史」を解析
   */
  function parseIcJctDetail(doc) {
    const roadElems = getElementsUnderHeading(doc, ["接続する道路", "接続道路"], "H2");
    const connectedRoads = [];

    roadElems.forEach(el => {
      if (el.tagName === "UL") {
        el.querySelectorAll("li").forEach(li => {
          const text = cleanText(li.textContent);
          if (!text) return;

          const natMatch = text.match(/国道(\d+)号/);
          const prefMatch = text.match(/(?:都|道|府|県)道(\d+)号/);
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
