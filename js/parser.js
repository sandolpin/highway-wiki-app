/* =========================================================
   parser.js : Wikipedia HTML を解析して構造化データに変換
   ========================================================= */

const WikiParser = (() => {
  /**
   * 注釈番号 [1] や [注釈 1] をテキストから除去
   */
  function cleanText(str) {
    return (str || "")
      .replace(/\[\s*(?:注釈?\vert{}出典\vert{}要出典\vert{}リンク切れ)?\s*\d*\s*\]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  /**
   * 要素内の <style> / <script> / 注釈などを除去した上でクリーンなテキストを取得
   */
  function extractCleanElementText(el) {
    if (!el) return "";
    const clone = el.cloneNode(true);
    clone.querySelectorAll("style, script, .mw-editsection, .mw-editsection-bracket, sup.reference").forEach(n => n.remove());
    return cleanText(clone.textContent);
  }

  /**
   * セル内の <br> やブロック要素を改行として保持し、行ごとの配列を返す
   */
  function extractCellLines(cell) {
    if (!cell) return [];
    const clone = cell.cloneNode(true);
    clone.querySelectorAll(".mw-editsection, script, style, sup.reference").forEach(n => n.remove());

    clone.querySelectorAll("br").forEach(br => {
      br.replaceWith("\n");
    });
    clone.querySelectorAll("p, div, li").forEach(el => {
      el.prepend("\n");
      el.append("\n");
    });

    return (clone.textContent || "")
      .split(/\n+/)
      .map(line => cleanText(line))
      .filter(line => line.length > 0);
  }

  /**
   * 見出し要素から [編集 | ソースを編集] を完全除去してテキスト取得
   */
  function cleanHeadingText(el) {
    return extractCleanElementText(el);
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
   * 基礎情報ボックス (table.infobox) からキー・バリューを抽出（内蔵<style>タグを除去）
   */
  function extractInfobox(doc) {
    const rows = [];
    const infobox = doc.querySelector("table.infobox");
    if (!infobox) return rows;

    infobox.querySelectorAll("tr").forEach(tr => {
      const th = tr.querySelector("th");
      const td = tr.querySelector("td");
      if (th && td) {
        const key = extractCleanElementText(th);
        const val = extractCleanElementText(td);
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
        const text = extractCleanElementText(child);
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
   * 個別施設名から種別サフィックスや状態括弧を除いたベース名（地名）を取得
   */
  function stripFacilitySuffix(name) {
    return cleanText(name)
      .replace(/[（(][^）)]*(?:廃止|閉鎖|休止|未開通|事業中|建設中|建設予定|開通予定|供用予定|予定|計画中|整備中)[^）)]*[）)]/g, "")
      .replace(/(スマートインターチェンジ|スマートIC|SIC|ジャンクション|JCT|インターチェンジ|IC|サービスエリア|SA|パーキングエリア|PA|本線料金所|料金所|TB|トンネル|TN|バスストップ|バス停留所|BS)/gi, "")
      .replace(/^[\/・／・\s]+|[\/・／・\s]+$/g, "")
      .trim();
  }

  const TYPE_SHORT_SUFFIX = {
    PA: "PA",
    SA: "SA",
    SIC: "SIC",
    IC: "IC",
    JCT: "JCT",
    BS: "BS",
    TB: "TB",
    TN: "TN"
  };

  const TYPE_WIKI_SUFFIX = {
    PA: "パーキングエリア",
    SA: "サービスエリア",
    SIC: "スマートインターチェンジ",
    IC: "インターチェンジ",
    JCT: "ジャンクション",
    BS: "バスストップ",
    TB: "本線料金所",
    TN: "トンネル"
  };

  /**
   * 施設名セルから表示名・種別・個別リンクを解析
   */
  function parseFacilityCell(nameCell) {
    const lines = extractCellLines(nameCell);
    const rawName = lines.join(" ") || extractCleanElementText(nameCell);
    let types = detectTypesFromText(rawName);
    if (types.length === 0) {
      types = ["IC"];
    }

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

    const lineTokens = [];
    for (const ln of lines) {
      const parts = ln.split(/\s*[\/・／]\s*/).map(p => p.trim()).filter(Boolean);
      for (const p of parts) {
        lineTokens.push({ text: p, types: detectTypesFromText(p) });
      }
    }

    let fallbackBase = "";
    for (const tok of lineTokens) {
      const stripped = stripFacilitySuffix(tok.text);
      if (stripped) {
        fallbackBase = stripped;
        break;
      }
    }
    if (!fallbackBase) {
      fallbackBase = stripFacilitySuffix(lines[0] || rawName) || rawName;
    }

    const defaultWiki = linkInfos.length > 0 ? linkInfos[0].wikiTitle : rawName;

    const badgeItems = types.map(t => {
      const exactMatch = linkInfos.find(info => info.types.includes(t));
      const tokenMatch = lineTokens.find(tok => tok.types.includes(t));
      const shortSuffix = TYPE_SHORT_SUFFIX[t] || t;
      const wikiSuffix = TYPE_WIKI_SUFFIX[t] || "";

      if (exactMatch) {
        const rawTok = (tokenMatch && tokenMatch.types.length === 1) ? tokenMatch.text : exactMatch.text;
        const strippedTok = stripFacilitySuffix(rawTok);
        const strippedWiki = stripFacilitySuffix(exactMatch.wikiTitle);
        const sName = strippedTok || strippedWiki || fallbackBase;

        let label = "";
        if (strippedTok) {
          label = rawTok.replace(/[（(][^）)]*(?:廃止|閉鎖|休止|未開通|事業中|建設中|建設予定|開通予定|供用予定|予定|計画中|整備中)[^）)]*[）)]/g, "").trim();
        } else if (sName) {
          label = `${sName}${shortSuffix}`;
        } else {
          label = exactMatch.wikiTitle || `${fallbackBase}${shortSuffix}`;
        }

        return {
          type: t,
          wikiTitle: exactMatch.wikiTitle,
          label,
          shortName: sName,
          isInactive: false
        };
      }

      if (tokenMatch) {
        const strippedTok = stripFacilitySuffix(tokenMatch.text);
        const sName = strippedTok || fallbackBase;
        const label = strippedTok
          ? tokenMatch.text.replace(/[（(][^）)]*(?:廃止|閉鎖|休止|未開通|事業中|建設中|建設予定|開通予定|供用予定|予定|計画中|整備中)[^）)]*[）)]/g, "").trim()
          : `${sName}${shortSuffix}`;
        const guessedWiki = sName && wikiSuffix ? `${sName}${wikiSuffix}` : defaultWiki;
        return {
          type: t,
          wikiTitle: guessedWiki,
          label,
          shortName: sName,
          isInactive: false
        };
      }

      if (wikiSuffix && fallbackBase) {
        return {
          type: t,
          wikiTitle: `${fallbackBase}${wikiSuffix}`,
          label: `${fallbackBase}${shortSuffix}`,
          shortName: fallbackBase,
          isInactive: false
        };
      }

      return {
        type: t,
        wikiTitle: defaultWiki,
        label: rawName,
        shortName: fallbackBase,
        isInactive: false
      };
    });

    const priorityOrder = ["IC", "JCT", "SA", "PA", "SIC", "TB", "TN", "BS"];
    let primaryBadge = badgeItems[0];
    for (const pType of priorityOrder) {
      const found = badgeItems.find(b => b.type === pType);
      if (found) {
        primaryBadge = found;
        break;
      }
    }

    const uniqueShortNames = [];
    for (const b of badgeItems) {
      if (b.shortName && !uniqueShortNames.includes(b.shortName)) {
        uniqueShortNames.push(b.shortName);
      }
    }
    const displayShortName = uniqueShortNames.length > 0 ? uniqueShortNames.join(" / ") : fallbackBase;

    return {
      types,
      badgeItems,
      primaryBadge,
      shortName: displayShortName,
      fullName: rawName,
      wikiTitle: primaryBadge ? primaryBadge.wikiTitle : defaultWiki
    };
  }

  /**
   * 高速道路・有料道路へのリンクかどうかを判定し、路線番号・正式路線名・Wikiタイトルを抽出
   */
  function extractHighwayLinks(containerEl) {
    if (!containerEl) return [];
    const results = [];
    const byWiki = new Map();
    const fullText = extractCleanElementText(containerEl);

    const isRouteCodeOnly = (str) => /^(E\d+[A-Z]?|C\d+[A-Z]?|CA|HW)$/i.test((str || "").trim());

    const isHighwayName = (str) => {
      if (!str || isRouteCodeOnly(str)) return false;
      if (/国道\d+号|(?:都|道|府|県)道\d+号|市道|町道|村道|連絡歩道/.test(str)) return false;
      return /(高速道路|自動車道|有料道路|道路|首都高速|阪神高速|名古屋高速|福岡高速|北九州高速|広島高速|アクアライン|バイパス|新道|圏央道|外環道|新東名|新名神)/.test(str);
    };

    const anchors = Array.from(containerEl.querySelectorAll("a[title]")).filter(a => {
      const href = a.getAttribute("href") || "";
      return !href.startsWith("#");
    });

    for (const a of anchors) {
      const rawLinkText = cleanText(a.textContent);
      const codeInLink = isRouteCodeOnly(rawLinkText) ? rawLinkText.toUpperCase() : "";
      const linkText = codeInLink ? "" : rawLinkText;

      const titleAttr = (a.getAttribute("title") || "")
        .replace(/\s*\(存在しないページ\)/g, "")
        .trim();
      const cleanTitle = isRouteCodeOnly(titleAttr) ? "" : titleAttr;

      const targetName = isHighwayName(cleanTitle)
        ? cleanTitle
        : (isHighwayName(linkText) ? linkText : "");

      if (!targetName) continue;

      const wikiTitle = cleanTitle || linkText || targetName;
      const resolvedName = linkText || cleanTitle || targetName;

      let routeNum = codeInLink;
      if (!routeNum) {
        const escapedName = resolvedName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const numBeforeMatch = fullText.match(new RegExp(`(E\\d+[A-Z]?|C\\d+[A-Z]?|CA)\\s*${escapedName}`));
        if (numBeforeMatch) {
          routeNum = numBeforeMatch[1];
        } else {
          const selfNumMatch = `${rawLinkText} ${titleAttr}`.match(/\b(E\d+[A-Z]?|C\d+[A-Z]?|CA)\b/);
          if (selfNumMatch) routeNum = selfNumMatch[1];
        }
      }

      if (byWiki.has(wikiTitle)) {
        const existing = byWiki.get(wikiTitle);
        if (!existing.num && routeNum) {
          existing.num = routeNum;
        }
        if (linkText && !isRouteCodeOnly(linkText)) {
          existing.name = linkText;
        }
      } else {
        const entry = {
          num: routeNum,
          name: resolvedName,
          wikiTitle
        };
        byWiki.set(wikiTitle, entry);
        results.push(entry);
      }
    }

    if (results.length === 0) {
      const regex = /(?:(E\d+[A-Z]?|C\d+[A-Z]?|CA)\s*)?([一-龠ぁ-んァ-ヶー]+(?:高速道路|自動車道|有料道路|道路|バイパス|新道))/g;
      let m;
      while ((m = regex.exec(fullText)) !== null) {
        const name = m[2];
        if (!byWiki.has(name)) {
          const entry = {
            num: m[1] || "",
            name,
            wikiTitle: name
          };
          byWiki.set(name, entry);
          results.push(entry);
        }
      }
    }

    return results;
  }

  function extractRouteNumbersFromText(text) {
    const matches = cleanText(text).match(/\b(E\d+[A-Z]?|C\d+[A-Z]?|CA)\b/g);
    return matches ? Array.from(new Set(matches)) : [];
  }

  /**
   * 路線ページのHTML解析
   */
  function parseRoutePage(htmlString) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlString, "text/html");
    const root = doc.querySelector(".mw-parser-output") || doc.body;

    const overview = {
      paragraphs: extractLeadParagraphs(doc),
      infobox: extractInfobox(doc)
    };

    const pageTitleEl = doc.querySelector("h1, .mw-page-title-main");
    const selfTitle = pageTitleEl ? cleanText(pageTitleEl.textContent) : "";

    const excludedH2 = [
      "概要", "歴史", "沿革", "路線状況", "道路施設", "主なトンネルと橋",
      "交通量", "車線・最高速度", "料金", "地理", "通過する自治体",
      "接続する高速道路", "関連項目", "脚注", "注釈", "出典", "参考文献", "外部リンク"
    ];

    const tableEntries = [];
    const postTableElements = [];
    let currentH2 = "";
    let currentSubHeading = "";

    for (const child of root.children) {
      const isH2 = child.tagName === "H2" || child.classList.contains("mw-heading2");
      const isH3 = child.tagName === "H3" || child.classList.contains("mw-heading3");
      const isH4 = child.tagName === "H4" || child.classList.contains("mw-heading4");

      if (isH2) {
        currentH2 = cleanHeadingText(child);
        currentSubHeading = "";
        continue;
      }
      if (isH3 || isH4) {
        currentSubHeading = cleanHeadingText(child);
        continue;
      }

      const isPrimaryIcH2 = /インターチェンジなど|出入口|インターチェンジ一覧|施設一覧/.test(currentH2);
      const isBranchH2 = currentH2 &&
        !excludedH2.some(ex => currentH2.includes(ex)) &&
        /支線|連絡路|富士吉田線|バイパス|有料道路|自動車道|線$/.test(currentH2);

      if (!isPrimaryIcH2 && !isBranchH2) continue;

      const tables = child.tagName === "TABLE"
        ? [child]
        : Array.from(child.querySelectorAll("table.wikitable"));

      if (tables.length > 0) {
        for (const tbl of tables) {
          const firstRowText = cleanText(tbl.querySelector("tr")?.textContent || "");
          if (/施設名|名称|なまえ|IC番号|番号|キロ|距離|接続路線/.test(firstRowText)) {
            let sectionTitle = "";
            if (isPrimaryIcH2) {
              sectionTitle = currentSubHeading || "本線";
            } else {
              sectionTitle = currentSubHeading ? `${currentH2}（${currentSubHeading}）` : currentH2;
            }
            const nums = extractRouteNumbersFromText(`${currentSubHeading} ${currentH2}`);
            tableEntries.push({
              table: tbl,
              sectionTitle,
              sectionRouteNum: nums.join(" / "),
              isBranch: isBranchH2 || /支線|連絡路|富士吉田線/.test(currentSubHeading)
            });
          }
        }
      } else if (isPrimaryIcH2 || isBranchH2) {
        postTableElements.push(child);
      }
    }

    const interchanges = [];
    const continuations = [];
    const seenContWikis = new Set();

    const addContinuation = (lk, noteText) => {
      if (!lk || !lk.wikiTitle) return;
      if (selfTitle && (lk.wikiTitle === selfTitle || lk.name === selfTitle)) return;
      if (seenContWikis.has(lk.wikiTitle)) return;
      seenContWikis.add(lk.wikiTitle);
      continuations.push({
        num: lk.num || "",
        name: lk.name || lk.wikiTitle,
        wikiTitle: lk.wikiTitle,
        note: noteText || "直結・連続する道路"
      });
    };

    for (const entry of tableEntries) {
      const parsed = parseInterchangeTable(entry.table, {
        sectionTitle: entry.sectionTitle,
        sectionRouteNum: entry.sectionRouteNum,
        isBranch: entry.isBranch
      });
      interchanges.push(...parsed.rows);
      for (const c of parsed.continuations) {
        addContinuation(c, c.note);
      }
    }

    for (const el of postTableElements) {
      const txt = extractCleanElementText(el);
      if (/直結|直通|連続|接続|つづき|続き|方面/.test(txt)) {
        const hwLinks = extractHighwayLinks(el);
        for (const lk of hwLinks) {
          addContinuation(lk, txt.length <= 45 ? txt : "直結・連続する道路");
        }
      }
    }

    const mainRows = interchanges.filter(r => !r.isBranch);
    if (mainRows.length > 0) {
      const lastRow = mainRows[mainRows.length - 1];
      if (lastRow && Array.isArray(lastRow.connectLinks)) {
        for (const lk of lastRow.connectLinks) {
          addContinuation(lk, `${lastRow.shortName}（終点側）から接続・直結`);
        }
      }
    }

    for (const row of overview.infobox) {
      if (/次道路|前道路/.test(row.key)) {
        const fakeDiv = document.createElement("div");
        fakeDiv.textContent = row.val;
        const links = extractHighwayLinks(fakeDiv);
        for (const lk of links) {
          addContinuation(lk, `${row.key}：${row.val}`);
        }
      }
    }

    const statusElements = getElementsUnderHeading(doc, ["路線状況"], "H2");
    const status = parseRouteStatus(statusElements);

    return {
      overview,
      interchanges,
      continuations,
      status,
      rawHtml: sanitizeRawHtml(doc)
    };
  }

  /**
   * 備考行が「併設BSや料金所など、本体以外の特定施設のみの廃止」かを判定して短縮ラベルを返す
   */
  function extractSubFacilityAbolishLabel(line) {
    const m = line.match(/([^\s、。（()）]{1,14}(?:BS|バスストップ|バス停留所|バス停|料金所|TB))\s*(?:は|が)?[^。、]*?(廃止|閉鎖|休止)/);
    if (m) {
      return `${m[1]}${m[2]}`;
    }
    return null;
  }

  /**
   * 施設行の「未開通・事業中・廃止」状態を、本体（IC/JCT/SA/PA）と併設サブ施設（SIC/BS）に分けて判定
   * （例：横浜町田ICの備考にある「横浜BSは廃止」でIC本体が廃止扱いになるのを防ぐ）
   */
  function evaluateFacilityStatus(parsedFacility, rawNoteLines, kmLines) {
    const statusRegex = /(廃止|閉鎖|休止|未開通|事業中|建設中|建設予定|開通予定|供用予定|予定|計画中|整備中)/;
    const abolishRegex = /(廃止|閉鎖|休止)/;
    const unopenedRegex = /(未開通|事業中|建設中|建設予定|開通予定|供用予定|予定|計画中|整備中)/;

    const fullName = parsedFacility.fullName || "";
    const filteredNoteLines = rawNoteLines.filter(ln => !extractSubFacilityAbolishLabel(ln));
    const noteText = filteredNoteLines.join(" / ");
    const combined = `${fullName} ${noteText}`;

    const types = parsedFacility.types || [];
    const hasMainOpenedType = types.some(t => ["PA", "SA", "IC", "JCT", "TB", "TN"].includes(t));
    const hasSubType = types.some(t => ["SIC", "BS"].includes(t));
    const hasValidKm = Array.isArray(kmLines) && kmLines.some(k => /\d/.test(k));

    if (!(hasMainOpenedType && hasSubType)) {
      const isAbolished = abolishRegex.test(combined);
      const isUnopened = unopenedRegex.test(combined);
      const isInactive = isAbolished || isUnopened;
      parsedFacility.badgeItems.forEach(b => {
        b.isInactive = isInactive;
      });
      return {
        isInactive,
        inactiveType: isAbolished ? "abolished" : (isUnopened ? "unopened" : null)
      };
    }

    const sicOnlyInactive =
      /(?:スマートIC|SIC)[^。、/／]*?(?:廃止|閉鎖|休止|未開通|事業中|建設中|建設予定|開通予定|供用予定|予定|計画中|整備中)/.test(combined) ||
      /(?:廃止|閉鎖|休止|未開通|事業中|建設中|建設予定|開通予定|供用予定|予定|計画中|整備中)[^。、/／]*?(?:スマートIC|SIC)/.test(combined);

    const bsOnlyInactive =
      /(?:バスストップ|バス停留所|バス停|BS)[^。、/／]*?(?:廃止|閉鎖|休止|未開通|事業中|建設中|建設予定|開通予定|供用予定|予定|計画中|整備中)/.test(combined) ||
      /(?:廃止|閉鎖|休止|未開通|事業中|建設中|建設予定|開通予定|供用予定|予定|計画中|整備中)[^。、/／]*?(?:バスストップ|バス停留所|バス停|BS)/.test(combined);

    const cleanedForMain = combined
      .replace(/(?:スマートIC|SIC|バスストップ|バス停留所|バス停|BS)[^。、/／]*?(?:廃止|閉鎖|休止|未開通|事業中|建設中|建設予定|開通予定|供用予定|予定|計画中|整備中)/g, "")
      .replace(/(?:廃止|閉鎖|休止|未開通|事業中|建設中|建設予定|開通予定|供用予定|予定|計画中|整備中)[^。、/／]*?(?:スマートIC|SIC|バスストップ|バス停留所|バス停|BS)/g, "");

    const mainExplicitAbolished = abolishRegex.test(cleanedForMain);
    const mainExplicitUnopened =
      /(?:PA|SA|IC|JCT|パーキングエリア|サービスエリア|インターチェンジ|ジャンクション)[^。、/／]*?(?:未開通|事業中|建設中|建設予定|開通予定|供用予定|予定|計画中|整備中)/.test(cleanedForMain) ||
      (!hasValidKm && unopenedRegex.test(cleanedForMain));

    const rowIsAbolished = mainExplicitAbolished;
    const rowIsUnopened = mainExplicitUnopened;
    const rowIsInactive = rowIsAbolished || rowIsUnopened;

    parsedFacility.badgeItems.forEach(b => {
      if (rowIsInactive) {
        b.isInactive = true;
      } else if (b.type === "SIC") {
        b.isInactive = sicOnlyInactive || statusRegex.test(combined);
      } else if (b.type === "BS") {
        b.isInactive = bsOnlyInactive;
      } else {
        b.isInactive = false;
      }
    });

    return {
      isInactive: rowIsInactive,
      inactiveType: rowIsAbolished ? "abolished" : (rowIsUnopened ? "unopened" : null)
    };
  }

  /**
   * Wikipediaの「インターチェンジなど」wikitable をグリッド展開して解析
   */
  function parseInterchangeTable(table, meta = {}) {
    const grid = expandTableToGrid(table);
    if (grid.length < 2) return { rows: [], continuations: [] };

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
    const continuations = [];
    let currentSectionTitle = meta.sectionTitle || "本線";
    let currentSectionRouteNum = meta.sectionRouteNum || "";
    let currentIsBranch = Boolean(meta.isBranch);

    for (let r = 1; r < grid.length; r++) {
      const row = grid[r];
      if (!row || row.length < 2) continue;

      if (row[0] && row[0].colspan >= 4) {
        const bannerCell = row[0].cell;
        const bannerText = extractCleanElementText(bannerCell);
        if (!bannerText) continue;

        if ((r === 1 || r >= grid.length - 2) && /直結|直通|連続|方面/.test(bannerText)) {
          const links = extractHighwayLinks(bannerCell);
          for (const lk of links) {
            continuations.push({
              ...lk,
              note: bannerText
            });
          }
          continue;
        }

        const nums = extractRouteNumbersFromText(bannerText);
        if (nums.length > 0 || /支線|連絡路|本線|富士吉田線|西宮線/.test(bannerText)) {
          currentSectionTitle = bannerText;
          if (nums.length > 0) {
            currentSectionRouteNum = nums.join(" / ");
          }
          if (/支線|連絡路|富士吉田線/.test(bannerText)) {
            currentIsBranch = true;
          }
        }
        continue;
      }

      const nameSlot = row[idxName];
      if (!nameSlot || !nameSlot.cell) continue;
      if (!nameSlot.isOrigin) continue;

      const parsedFacility = parseFacilityCell(nameSlot.cell);
      if (!parsedFacility.fullName || parsedFacility.fullName === "-" || parsedFacility.fullName === "―") {
        continue;
      }

      const numRaw = row[idxNum] ? cleanText(row[idxNum].cell.textContent) : "-";
      const safeNum = (numRaw === "-" || numRaw === "―" || numRaw.length > 10) ? "-" : numRaw;

      const rawKmLines = row[idxKm] ? extractCellLines(row[idxKm].cell) : [];
      const kmLines = [];
      for (const line of rawKmLines) {
        if (line === "-" || line === "―") continue;
        const twoNums = line.match(/^([0-9]+(?:\.[0-9]+)?)\s+([0-9]+(?:\.[0-9]+)?)$/);
        if (twoNums) {
          kmLines.push(`${twoNums[1]}km`, `${twoNums[2]}km`);
        } else if (/^[0-9.]+$/.test(line)) {
          kmLines.push(`${line}km`);
        } else if (/[0-9]/.test(line) && !/km/i.test(line)) {
          kmLines.push(line.replace(/([0-9]+(?:\.[0-9]+)?)/g, "$1km"));
        } else {
          kmLines.push(line);
        }
      }
      const kmDisplay = kmLines.join(" / ");

      const connectLines = row[idxConnect] ? extractCellLines(row[idxConnect].cell).filter(l => l !== "-" && l !== "―") : [];
      const connectRaw = connectLines.join(" / ");
      const connectLinks = row[idxConnect] ? extractHighwayLinks(row[idxConnect].cell) : [];

      const rawNoteLines = row[idxNote] ? extractCellLines(row[idxNote].cell).filter(l => l !== "-" && l !== "―") : [];
      const noteLines = rawNoteLines.map(nl => {
        const subAbolish = extractSubFacilityAbolishLabel(nl);
        if (subAbolish) return subAbolish;

        if (/廃止|閉鎖|休止|未開通|事業中|建設中|建設予定|開通予定|供用予定|予定|計画中|整備中/.test(nl)) {
          if (nl.length <= 16) return nl;
          const m = nl.match(/((?:スマートIC|SIC|BS)?(?:は)?(?:廃止|閉鎖|休止|未開通|事業中|建設中|建設予定|開通予定|供用予定|予定|計画中|整備中))/);
          return m ? m[1] : nl;
        }
        return nl.length <= 22 ? nl : "";
      }).filter(Boolean);

      const shortNote = noteLines.join(" / ");
      const fullNote = rawNoteLines.join(" / ");

      const statusResult = evaluateFacilityStatus(parsedFacility, rawNoteLines, kmLines);

      list.push({
        num: safeNum,
        types: parsedFacility.types,
        badgeItems: parsedFacility.badgeItems,
        primaryBadge: parsedFacility.primaryBadge,
        shortName: parsedFacility.shortName,
        fullName: parsedFacility.fullName,
        wikiTitle: parsedFacility.wikiTitle,
        km: kmDisplay,
        kmLines,
        note: shortNote,
        noteLines,
        fullNote,
        connect: connectRaw,
        connectLines,
        connectLinks,
        isInactive: statusResult.isInactive,
        inactiveType: statusResult.inactiveType,
        sectionTitle: currentSectionTitle,
        sectionRouteNum: currentSectionRouteNum,
        isBranch: currentIsBranch
      });
    }

    return { rows: list, continuations };
  }

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

        const sectionText = row[0] ? extractCleanElementText(row[0].cell) : "";
        if (!sectionText || sectionText.includes("区間")) continue;

        const laneCellText = row[1] ? extractCleanElementText(row[1].cell) : "";
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

        const speedCellText = row[2] ? extractCleanElementText(row[2].cell) : "";
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
        const txt = extractCleanElementText(el);
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

  function isGeneralParkingText(text) {
    return /[ぷらぶ]らっとパーク|ウォークイン|ウェルカムゲート|一般道|外部駐車場|高速道路外/.test(text || "");
  }

  function getGeneralParkingLabel(text) {
    if (/ぶらっとパーク/.test(text)) return "一般道（ぶらっとパーク）";
    if (/ぷらっとパーク/.test(text)) return "一般道（ぷらっとパーク）";
    if (/ウォークイン/.test(text)) return "一般道（ウォークインゲート）";
    if (/ウェルカムゲート/.test(text)) return "一般道（ウェルカムゲート）";
    return "一般道側駐車場";
  }

  function extractParkingCounts(text) {
    if (!text) return null;
    const largeM = text.match(/大型(?:車)?[^0-9]{0,6}([0-9,]+)\s*台/);
    const smallM = text.match(/(?:小型(?:車)?|普通(?:車)?)[^0-9]{0,6}([0-9,]+)\s*台/);
    const handiM = text.match(/(?:身障者(?:用)?|障がい者(?:用)?|車椅子)[^0-9]{0,6}([0-9,]+)\s*台/);

    const large = largeM ? largeM[1] + "台" : null;
    const small = smallM ? smallM[1] + "台" : null;
    const handicapped = handiM ? handiM[1] + "台" : null;

    let total = null;
    if (!large && !small) {
      const totalM = text.match(/([0-9,]+)\s*台/);
      if (totalM) total = totalM[1] + "台";
    }

    if (!large && !small && !handicapped && !total) return null;
    return { large, small, handicapped, total };
  }

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

  function parseSapaFacilities(doc) {
    const facilityElems = getElementsUnderHeading(doc, ["施設"], "H2");
    const directions = [];
    let currentDir = null;

    const createDir = (title) => ({
      title,
      largeParking: null,
      smallParking: null,
      handicappedParking: null,
      totalParking: null,
      generalParking: [],
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
        parseSapaTable(el, currentDir);
      }
    }
    pushCurrent();

    return directions.filter(d =>
      d.largeParking || d.smallParking || d.totalParking || d.handicappedParking ||
      (d.generalParking && d.generalParking.length > 0) ||
      d.hasToilet || d.hasEv || d.hasGs || d.hasInfo || d.hasVending ||
      d.categories.length > 0 || d.others.length > 0
    );
  }

  function parseSapaListItems(ul, dirObj) {
    const topLis = Array.from(ul.children).filter(c => c.tagName === "LI");

    for (const li of topLis) {
      const nestedUl = li.querySelector("ul");
      const cloneLi = li.cloneNode(true);
      cloneLi.querySelectorAll("ul, style, script, sup.reference").forEach(u => u.remove());
      const lineText = cleanText(cloneLi.textContent);

      const subTexts = nestedUl
        ? Array.from(nestedUl.querySelectorAll("li")).map(s => extractCleanElementText(s)).filter(Boolean)
        : [];
      const combinedText = [lineText, ...subTexts].join(" ");

      if (isGeneralParkingText(lineText)) {
        const gpCounts = extractParkingCounts(combinedText);
        if (gpCounts) {
          dirObj.generalParking.push({
            label: getGeneralParkingLabel(lineText),
            ...gpCounts
          });
        }
        const nonParkingNotes = subTexts.filter(st => !extractParkingCounts(st));
        if (nonParkingNotes.length > 0) {
          dirObj.others.push(`${lineText}（${nonParkingNotes.join(" / ")}）`);
        } else if (!gpCounts && lineText) {
          dirObj.others.push(lineText);
        }
        continue;
      }

      if (/駐車場/.test(lineText)) {
        const directSubLis = nestedUl ? Array.from(nestedUl.children).filter(c => c.tagName === "LI") : [];
        const mainSubTexts = [];

        if (directSubLis.length > 0) {
          for (const subLi of directSubLis) {
            const subFull = extractCleanElementText(subLi);
            if (isGeneralParkingText(subFull)) {
              const gpCounts = extractParkingCounts(subFull);
              if (gpCounts) {
                dirObj.generalParking.push({
                  label: getGeneralParkingLabel(subFull),
                  ...gpCounts
                });
              }
            } else {
              mainSubTexts.push(subFull);
            }
          }
        }

        const inlineGpMatch = combinedText.match(/([^。、（）()]*?(?:[ぷらぶ]らっとパーク|ウォークイン|ウェルカムゲート|一般道|外部駐車場)[^。、）)]*)/);
        if (inlineGpMatch && directSubLis.length === 0) {
          const gpCounts = extractParkingCounts(inlineGpMatch[1]);
          if (gpCounts) {
            dirObj.generalParking.push({
              label: getGeneralParkingLabel(inlineGpMatch[1]),
              ...gpCounts
            });
          }
        }

        const rawMainText = directSubLis.length > 0
          ? [lineText, ...mainSubTexts].join(" ")
          : combinedText.replace(/[（(][^）)]*(?:[ぷらぶ]らっとパーク|ウォークイン|ウェルカムゲート|一般道|外部駐車場)[^）)]*[）)]/g, "");

        const mainCounts = extractParkingCounts(rawMainText);
        if (mainCounts) {
          if (mainCounts.large && !dirObj.largeParking) dirObj.largeParking = mainCounts.large;
          if (mainCounts.small && !dirObj.smallParking) dirObj.smallParking = mainCounts.small;
          if (mainCounts.handicapped && !dirObj.handicappedParking) dirObj.handicappedParking = mainCounts.handicapped;
          if (mainCounts.total && !dirObj.largeParking && !dirObj.smallParking && !dirObj.totalParking) {
            dirObj.totalParking = mainCounts.total;
          }
        } else if (mainSubTexts.length > 0) {
          dirObj.others.push(`駐車場（${mainSubTexts.join(" / ")}）`);
        }
        continue;
      }

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
      const cells = Array.from(tr.querySelectorAll("th, td")).map(c => extractCleanElementText(c));
      if (cells.length < 2) return;
      const label = cells[0];
      const val = cells.slice(1).join(" / ");
      if (!label || !val) return;

      if (isGeneralParkingText(label)) {
        const gpCounts = extractParkingCounts(val);
        if (gpCounts) {
          dirObj.generalParking.push({
            label: getGeneralParkingLabel(label),
            ...gpCounts
          });
        }
      } else if (/駐車場/.test(label)) {
        const counts = extractParkingCounts(val);
        if (counts) {
          if (counts.large && !dirObj.largeParking) dirObj.largeParking = counts.large;
          if (counts.small && !dirObj.smallParking) dirObj.smallParking = counts.small;
          if (counts.handicapped && !dirObj.handicappedParking) dirObj.handicappedParking = counts.handicapped;
          if (counts.total && !dirObj.largeParking && !dirObj.smallParking && !dirObj.totalParking) {
            dirObj.totalParking = counts.total;
          }
        }
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

  function parseIcJctDetail(doc) {
    const roadElems = getElementsUnderHeading(doc, ["接続する道路", "接続道路"], "H2");
    const connectedRoads = [];

    roadElems.forEach(el => {
      if (el.tagName === "UL") {
        el.querySelectorAll("li").forEach(li => {
          const text = extractCleanElementText(li);
          if (!text) return;

          const natMatch = text.match(/国道(\d+)号/);
          const prefMatch = text.match(/(?:都|道|府|県)道(\d+)号/);
          const hwLinks = extractHighwayLinks(li);

          if (hwLinks.length > 0) {
            const firstHw = hwLinks[0];
            connectedRoads.push({
              kind: "highway",
              num: firstHw.num || "HW",
              name: text,
              hwName: firstHw.name,
              wikiTitle: firstHw.wikiTitle
            });
          } else if (natMatch) {
            connectedRoads.push({ kind: "national", num: natMatch[1], name: text });
          } else if (prefMatch) {
            connectedRoads.push({ kind: "pref", num: prefMatch[1], name: text });
          } else if (/高速道路|自動車道|首都高速|阪神高速|有料道路/.test(text)) {
            const hwMatch = text.match(/(E\d+[A-Z]?|C\d+)\s*([^（(\s]+)/);
            const hwName = hwMatch ? hwMatch[2] : text;
            connectedRoads.push({
              kind: "highway",
              num: hwMatch ? hwMatch[1] : "HW",
              name: text,
              hwName,
              wikiTitle: hwName
            });
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
          const t = extractCleanElementText(li);
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
