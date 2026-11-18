/* =========================================================
   app.js : 各画面の初期化・イベント制御・画面遷移・ホバープレビュー
   ========================================================= */

/**
 * マウスホバー時のWikipedia概要プレビューカード管理
 */
const WikiHoverPreview = (() => {
  let popoverEl = null;
  let currentTargetKey = "";
  let hideTimer = null;

  function ensurePopover() {
    if (!popoverEl) {
      popoverEl = document.createElement("div");
      popoverEl.className = "wiki-hover-popover";
      document.body.appendChild(popoverEl);
    }
    return popoverEl;
  }

  function positionPopover(clientX, clientY) {
    const el = ensurePopover();
    const pad = 16;
    const rect = el.getBoundingClientRect();
    const width = rect.width || 330;
    const height = rect.height || 150;

    let left = clientX + pad;
    let top = clientY + pad;

    if (left + width > window.innerWidth - 12) {
      left = Math.max(12, clientX - width - pad);
    }
    if (top + height > window.innerHeight - 12) {
      top = Math.max(12, clientY - height - pad);
    }

    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }

  async function show({ key, title, types, metaLines, wikiTitle, hintText, event }) {
    clearTimeout(hideTimer);
    const el = ensurePopover();
    currentTargetKey = key;

    const badgesHtml = types ? WikiRenderer.renderFacilityBadges(types) : "";
    const metaHtml = (metaLines || []).filter(Boolean).map(m => `<div>${WikiRenderer.escapeHtml(m)}</div>`).join("");

    el.innerHTML = `
      <div class="popover-header">
        ${badgesHtml}
        <div class="popover-title">${WikiRenderer.escapeHtml(title)}</div>
      </div>
      ${metaHtml ? `<div class="popover-meta">${metaHtml}</div>` : ""}
      <div class="popover-summary" id="popoverSummaryBody">Wikipediaから概要を読み込み中...</div>
      <div class="popover-hint">${WikiRenderer.escapeHtml(hintText || "クリックで詳細を表示")}</div>
    `;

    el.classList.add("visible");
    if (event) positionPopover(event.clientX, event.clientY);

    if (wikiTitle) {
      const summaryData = await WikiAPI.fetchPageSummary(wikiTitle);
      if (currentTargetKey !== key) return;
      const bodyEl = document.getElementById("popoverSummaryBody");
      if (bodyEl) {
        if (summaryData && summaryData.extract) {
          bodyEl.textContent = summaryData.extract;
        } else {
          bodyEl.textContent = "Wikipediaの要約文がまだ登録されていないか、単独記事がありません。";
        }
        if (event) positionPopover(event.clientX, event.clientY);
      }
    }
  }

  function move(event) {
    if (popoverEl && popoverEl.classList.contains("visible")) {
      positionPopover(event.clientX, event.clientY);
    }
  }

  function hide() {
    hideTimer = setTimeout(() => {
      currentTargetKey = "";
      if (popoverEl) {
        popoverEl.classList.remove("visible");
      }
    }, 80);
  }

  return { show, move, hide };
})();

/**
 * routes.json マスターから路線番号・正式名称を補完して route.html へ遷移
 */
async function navigateToHighwayRoute({ num, name, wikiTitle }) {
  const routes = await WikiAPI.fetchRoutesMaster();
  const cleanWiki = (wikiTitle || name || "").trim();
  const matched = routes.find(r =>
    r.wikiTitle === cleanWiki ||
    r.name === cleanWiki ||
    r.name === name
  );

  const finalId = matched ? matched.id : "custom";
  const finalNum = (num && num !== "HW") ? num : (matched ? matched.number : "HW");
  const finalName = matched ? matched.name : (name || cleanWiki);
  const finalWiki = matched ? matched.wikiTitle : cleanWiki;

  const params = new URLSearchParams({
    id: finalId,
    num: finalNum,
    name: finalName,
    wiki: finalWiki
  });
  location.href = `route.html?${params.toString()}`;
}

document.addEventListener("DOMContentLoaded", () => {
  const pageType = document.body.dataset.page;
  if (pageType === "index") {
    initIndexPage();
  } else if (pageType === "route") {
    initRoutePage();
  } else if (pageType === "facility") {
    initFacilityPage();
  }
});

/* ---------------------------------------------------------
   1. トップ画面 (index.html)
   --------------------------------------------------------- */
async function initIndexPage() {
  const routes = await WikiAPI.fetchRoutesMaster();
  const state = {
    query: "",
    operator: "all",
    region: "all"
  };

  const searchInput = document.getElementById("routeSearchInput");
  const directForm = document.getElementById("directWikiForm");
  const directInput = document.getElementById("directWikiInput");
  const filterContainer = document.getElementById("operatorFilters");
  const resetRegionBtn = document.getElementById("resetRegionBtn");
  const mapWrap = document.getElementById("japanMapWrap");
  const grid = document.getElementById("routesGrid");
  const countBadge = document.getElementById("routesCountBadge");
  const heading = document.getElementById("routesListHeading");

  const regionNames = {
    all: "すべての高速道路路線",
    hokkaido: "北海道地方の高速道路",
    tohoku: "東北地方の高速道路",
    kanto: "関東地方の高速道路",
    chubu: "中部・甲信越地方の高速道路",
    kinki: "近畿地方の高速道路",
    chugoku: "中国地方の高速道路",
    shikoku: "四国地方の高速道路",
    kyushu: "九州・沖縄地方の高速道路"
  };

  function navigateToRoute(routeObj) {
    const params = new URLSearchParams({
      id: routeObj.id,
      num: routeObj.number,
      name: routeObj.name,
      wiki: routeObj.wikiTitle
    });
    location.href = `route.html?${params.toString()}`;
  }

  function render() {
    WikiRenderer.renderJapanMap(
      mapWrap,
      routes,
      state.region,
      (selectedRegion) => {
        state.region = state.region === selectedRegion ? "all" : selectedRegion;
        render();
      },
      (routeId) => {
        const found = routes.find(r => r.id === routeId);
        if (found) navigateToRoute(found);
      }
    );

    const q = state.query.trim().toLowerCase();
    const filtered = routes.filter(r => {
      if (state.region !== "all" && !r.region.includes(state.region)) {
        return false;
      }
      if (state.operator !== "all") {
        if (state.operator === "urban") {
          if (!/首都高速|本州四国/.test(r.operator)) return false;
        } else if (!r.operator.includes(state.operator)) {
          return false;
        }
      }
      if (q) {
        const target = `${r.number} ${r.name} ${r.section} ${r.regionLabel} ${r.operator}`.toLowerCase();
        if (!target.includes(q)) return false;
      }
      return true;
    });

    heading.textContent = regionNames[state.region] || "高速道路路線一覧";
    countBadge.textContent = `${filtered.length} 路線`;

    if (filtered.length === 0) {
      grid.innerHTML = `<p style="color:#666; padding: 20px;">条件に一致する路線が見つかりませんでした。</p>`;
      return;
    }

    grid.innerHTML = filtered.map(r => {
      const isUrban = r.color === "#0068b7";
      return `
        <article class="route-card" data-id="${WikiRenderer.escapeHtml(r.id)}" tabindex="0">
          <div class="route-card-top">
            <span class="route-num-badge ${isUrban ? "urban" : ""}">${WikiRenderer.escapeHtml(r.number)}</span>
            <h3 class="route-card-name">${WikiRenderer.escapeHtml(r.name)}</h3>
          </div>
          <div class="route-card-meta">
            <div>区間：${WikiRenderer.escapeHtml(r.section)}</div>
            <div class="route-card-tags">
              <span class="operator-tag">${WikiRenderer.escapeHtml(r.operator)}</span>
              <span class="length-tag">総延長 ${WikiRenderer.escapeHtml(r.length)}</span>
            </div>
          </div>
        </article>
      `;
    }).join("");

    grid.querySelectorAll(".route-card").forEach(card => {
      const rt = routes.find(x => x.id === card.dataset.id);
      if (!rt) return;

      const go = () => navigateToRoute(rt);
      card.addEventListener("click", go);
      card.addEventListener("keydown", e => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          go();
        }
      });

      card.addEventListener("mouseenter", e => {
        WikiHoverPreview.show({
          key: `route_${rt.id}`,
          title: `${rt.number} ${rt.name}`,
          metaLines: [`区間：${rt.section}（総延長 ${rt.length}）`, `管轄：${rt.operator}`],
          wikiTitle: rt.wikiTitle,
          hintText: "クリックでIC一覧・路線状況へ",
          event: e
        });
      });
      card.addEventListener("mousemove", e => WikiHoverPreview.move(e));
      card.addEventListener("mouseleave", () => WikiHoverPreview.hide());
    });
  }

  searchInput.addEventListener("input", e => {
    state.query = e.target.value;
    render();
  });

  filterContainer.querySelectorAll(".filter-pill").forEach(btn => {
    btn.addEventListener("click", () => {
      filterContainer.querySelectorAll(".filter-pill").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      state.operator = btn.dataset.operator;
      render();
    });
  });

  resetRegionBtn.addEventListener("click", () => {
    state.region = "all";
    render();
  });

  directForm.addEventListener("submit", e => {
    e.preventDefault();
    const title = directInput.value.trim();
    if (!title) return;
    navigateToHighwayRoute({ num: "HW", name: title, wikiTitle: title });
  });

  render();
}

/* ---------------------------------------------------------
   2. 路線詳細画面 (route.html)
   --------------------------------------------------------- */
async function initRoutePage() {
  const params = new URLSearchParams(location.search);
  const routeNum = params.get("num") || "E1";
  const routeName = params.get("name") || "東名高速道路";
  const wikiTitle = params.get("wiki") || routeName;
  let activeTab = params.get("tab") || "interchanges";

  document.title = `${routeNum} ${routeName} - 高速道路Wikipediaガイド`;
  const numBadge = document.getElementById("routeNumBadge");
  const titleNameEl = document.getElementById("routeTitleName");
  const sourceLink = document.getElementById("wikiSourceLink");
  const mainContent = document.getElementById("routeMainContent");
  const navItems = document.querySelectorAll(".sidebar-nav .nav-item");

  numBadge.textContent = routeNum;
  if (/^C\d/.test(routeNum) && routeName.includes("首都高速")) {
    numBadge.classList.add("urban");
  }
  titleNameEl.textContent = routeName;

  const routesMaster = await WikiAPI.fetchRoutesMaster();
  let parsedData = null;

  function updateTabUI() {
    navItems.forEach(btn => {
      btn.classList.toggle("active", btn.dataset.tab === activeTab);
    });
  }

  /**
   * 施設詳細画面へ遷移（ICとBS併設時でもメイン施設の個別名・個別種別を正しく渡す）
   */
  function goToFacility(item, idx, overrideBadge = null) {
    const primary = overrideBadge || item.primaryBadge || (item.badgeItems && item.badgeItems[0]);
    const targetWiki = primary ? primary.wikiTitle : item.wikiTitle;
    const targetTypes = primary ? [primary.type] : [item.types[0] || "IC"];
    const targetFullName = primary ? primary.label : item.fullName;
    const targetShortName = (primary && primary.shortName) ? primary.shortName : item.shortName;

    const fParams = new URLSearchParams({
      routeNum,
      routeName,
      routeWiki: wikiTitle,
      index: String(idx),
      num: item.num,
      shortName: targetShortName,
      fullName: targetFullName,
      types: targetTypes.join(","),
      km: item.km,
      wiki: targetWiki
    });
    location.href = `facility.html?${fParams.toString()}`;
  }

  /**
   * 接続路線セルのHTML生成（高速道路が含まれる場合はクリック可能なリンクボタンにする）
   */
  function renderConnectCell(item) {
    const links = Array.isArray(item.connectLinks) ? item.connectLinks : [];
    const lines = Array.isArray(item.connectLines) && item.connectLines.length > 0
      ? item.connectLines
      : (item.connect ? [item.connect] : []);

    if (links.length === 0) {
      if (lines.length > 1) {
        return `<div class="multi-line-cell">${lines.map(l => `<span class="multi-line-item">${WikiRenderer.escapeHtml(l)}</span>`).join("")}</div>`;
      }
      return WikiRenderer.escapeHtml(item.connect || "");
    }

    // 高速道路リンクチップ + 一般道テキストの併用表示
    const hwChipsHtml = links.map(lk => {
      const matched = routesMaster.find(r => r.wikiTitle === lk.wikiTitle || r.name === lk.name);
      const dispNum = lk.num || (matched ? matched.number : "");
      return `
        <button type="button"
                class="connect-hw-link"
                data-hw-num="${WikiRenderer.escapeHtml(dispNum || "HW")}"
                data-hw-name="${WikiRenderer.escapeHtml(lk.name)}"
                data-hw-wiki="${WikiRenderer.escapeHtml(lk.wikiTitle)}"
                title="${WikiRenderer.escapeHtml(lk.name)} の路線ページへ移動">
          ${dispNum ? `<span class="connect-hw-num">${WikiRenderer.escapeHtml(dispNum)}</span>` : ""}
          <span>${WikiRenderer.escapeHtml(lk.name)} ↗</span>
        </button>
      `;
    }).join("");

    // 高速道路名以外の一般道テキストがあれば残す
    const nonHwLines = lines.filter(ln => !links.some(lk => ln.includes(lk.name)));
    const nonHwHtml = nonHwLines.length > 0
      ? `<div style="margin-top: 2px;">${nonHwLines.map(l => WikiRenderer.escapeHtml(l)).join(" / ")}</div>`
      : "";

    return `<div>${hwChipsHtml}${nonHwHtml}</div>`;
  }

  function renderCurrentTab() {
    if (!parsedData) return;
    updateTabUI();

    if (activeTab === "overview") {
      mainContent.innerHTML = WikiRenderer.renderOverviewTab(parsedData.overview, routeName);
      return;
    }

    if (activeTab === "interchanges") {
      const list = parsedData.interchanges;
      if (!list || list.length === 0) {
        mainContent.innerHTML = `
          <div class="notice-banner">この路線記事では「インターチェンジなど」の表を自動抽出できませんでした。</div>
          <div class="raw-wiki-container">${parsedData.rawHtml}</div>
        `;
        return;
      }

      sessionStorage.setItem("hw_current_ic_list", JSON.stringify(list));

      const rowsHtml = list.map((item, idx) => {
        const kmHtml = (item.kmLines && item.kmLines.length > 1)
          ? `<div class="multi-line-cell">${item.kmLines.map(k => `<span class="multi-line-item">${WikiRenderer.escapeHtml(k)}</span>`).join("")}</div>`
          : WikiRenderer.escapeHtml(item.km);

        const noteHtml = (item.noteLines && item.noteLines.length > 1)
          ? `<div class="multi-line-cell">${item.noteLines.map(n => `<span class="multi-line-item">${WikiRenderer.escapeHtml(n)}</span>`).join("")}</div>`
          : WikiRenderer.escapeHtml(item.note);

        return `
          <div class="ic-row-card" data-index="${idx}" role="button" tabindex="0">
            <div class="ic-col-num">${WikiRenderer.escapeHtml(item.num)}</div>
            <div class="ic-col-name">
              ${WikiRenderer.renderFacilityBadges(item.types, item.badgeItems, true)}
              <span>${WikiRenderer.escapeHtml(item.shortName)}</span>
            </div>
            <div class="ic-col-km">${kmHtml}</div>
            <div class="ic-col-note">${noteHtml}</div>
            <div class="ic-col-connect">${renderConnectCell(item)}</div>
          </div>
        `;
      }).join("");

      mainContent.innerHTML = `
        <div class="ic-table-header">
          <div>IC番号</div>
          <div>なまえ</div>
          <div>起点から</div>
          <div>備考</div>
          <div>接続路線</div>
        </div>
        <div class="ic-list-container">
          ${rowsHtml}
        </div>
      `;

      mainContent.querySelectorAll(".ic-row-card").forEach(row => {
        const idx = Number(row.dataset.index);
        const item = list[idx];
        if (!item) return;

        row.addEventListener("click", () => goToFacility(item, idx, null));
        row.addEventListener("keydown", e => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            goToFacility(item, idx, null);
          }
        });

        row.addEventListener("mouseenter", e => {
          const mainLabel = item.primaryBadge ? item.primaryBadge.label : item.fullName;
          WikiHoverPreview.show({
            key: `ic_${idx}_${item.wikiTitle}`,
            title: `${item.num !== "-" ? `[${item.num}] ` : ""}${mainLabel}`,
            types: item.types,
            metaLines: [
              item.km ? `起点から：${item.km}` : "",
              item.connect ? `接続路線：${item.connect}` : "",
              item.fullNote ? `備考：${item.fullNote}` : ""
            ],
            wikiTitle: item.wikiTitle,
            hintText: item.badgeItems.length > 1
              ? "各アイコン個別クリックでそれぞれの施設記事へ移動"
              : "クリックで詳細ページへ移動",
            event: e
          });
        });
        row.addEventListener("mousemove", e => WikiHoverPreview.move(e));
        row.addEventListener("mouseleave", () => WikiHoverPreview.hide());

        // 施設種別バッジ（IC / BS / PA / SIC 等）の個別クリック
        row.querySelectorAll(".clickable-badge").forEach(badgeEl => {
          const bWiki = badgeEl.dataset.wiki;
          const bType = badgeEl.dataset.type;
          const bLabel = badgeEl.dataset.label;
          const bShort = badgeEl.dataset.short;

          badgeEl.addEventListener("click", e => {
            e.stopPropagation();
            goToFacility(item, idx, { wikiTitle: bWiki, type: bType, label: bLabel, shortName: bShort });
          });

          badgeEl.addEventListener("mouseenter", e => {
            e.stopPropagation();
            WikiHoverPreview.show({
              key: `badge_${idx}_${bType}_${bWiki}`,
              title: bLabel,
              types: [bType],
              metaLines: [item.km ? `起点から：${item.km}` : ""],
              wikiTitle: bWiki,
              hintText: `クリックで「${bLabel}」の記事へ直接移動`,
              event: e
            });
          });
          badgeEl.addEventListener("mousemove", e => {
            e.stopPropagation();
            WikiHoverPreview.move(e);
          });
        });

        // 接続路線列の高速道路リンクボタンのクリック
        row.querySelectorAll(".connect-hw-link").forEach(hwBtn => {
          const hwNum = hwBtn.dataset.hwNum;
          const hwName = hwBtn.dataset.hwName;
          const hwWiki = hwBtn.dataset.hwWiki;

          hwBtn.addEventListener("click", e => {
            e.stopPropagation();
            navigateToHighwayRoute({ num: hwNum, name: hwName, wikiTitle: hwWiki });
          });

          hwBtn.addEventListener("mouseenter", e => {
            e.stopPropagation();
            WikiHoverPreview.show({
              key: `conn_hw_${idx}_${hwWiki}`,
              title: `${hwNum !== "HW" ? `[${hwNum}] ` : ""}${hwName}`,
              metaLines: ["接続する高速道路"],
              wikiTitle: hwWiki,
              hintText: `クリックで「${hwName}」の路線ページへ移動`,
              event: e
            });
          });
          hwBtn.addEventListener("mousemove", e => {
            e.stopPropagation();
            WikiHoverPreview.move(e);
          });
        });
      });
      return;
    }

    if (activeTab === "status") {
      const { laneSpeedRows, proseSections } = parsedData.status;

      const laneTableHtml = laneSpeedRows && laneSpeedRows.length > 0 ? `
        <h2 class="section-main-title">車線数・最高速度</h2>
        <div class="status-table-header">
          <div class="status-header-col"><span>区間</span><span class="status-header-line"></span></div>
          <div class="status-header-col"><span>車線(上り・下り)</span><span class="status-header-line"></span></div>
          <div class="status-header-col"><span>最高速度</span></div>
        </div>
        <div class="status-rows">
          ${laneSpeedRows.map(r => `
            <div class="status-row">
              <div class="status-section-name">${WikiRenderer.escapeHtml(r.section)}</div>
              <div>${WikiRenderer.renderLanesVisual(r.upLanes, r.downLanes)}</div>
              <div>${WikiRenderer.renderSpeedSigns(r.speeds)}</div>
            </div>
          `).join("")}
        </div>
      ` : `<div class="notice-banner">車線数・最高速度の専用表データが見つからなかったため、解説文を表示します。</div>`;

      const proseHtml = proseSections && proseSections.length > 0
        ? proseSections.map(sec => `
            <div class="wiki-prose-block">
              <h3>${WikiRenderer.escapeHtml(sec.title)}</h3>
              ${sec.paragraphs.map(p => `<p>${WikiRenderer.escapeHtml(p)}</p>`).join("")}
            </div>
          `).join("")
        : "";

      mainContent.innerHTML = laneTableHtml + proseHtml;
    }
  }

  navItems.forEach(btn => {
    btn.addEventListener("click", () => {
      WikiHoverPreview.hide();
      activeTab = btn.dataset.tab;
      const newUrl = new URL(location.href);
      newUrl.searchParams.set("tab", activeTab);
      history.replaceState(null, "", newUrl.toString());
      renderCurrentTab();
    });
  });

  try {
    const pageData = await WikiAPI.fetchPageHtml(wikiTitle);
    sourceLink.href = pageData.wikiUrl;
    parsedData = WikiParser.parseRoutePage(pageData.html);
    renderCurrentTab();
  } catch (err) {
    mainContent.innerHTML = `
      <div class="notice-banner" style="background:#ffebee; border-color:#ef9a9a; color:#b71c1c;">
        読み込みエラー：${WikiRenderer.escapeHtml(err.message)}
      </div>
    `;
  }
}

/* ---------------------------------------------------------
   3. 施設詳細画面 (facility.html : PA/SA & IC/JCT/BS 1ページ統合表示)
   --------------------------------------------------------- */
async function initFacilityPage() {
  const params = new URLSearchParams(location.search);
  const routeNum = params.get("routeNum") || "E1";
  const routeName = params.get("routeName") || "東名高速道路";
  const routeWiki = params.get("routeWiki") || routeName;
  const currentIndex = Number(params.get("index") || "-1");
  const num = params.get("num") || "";
  const shortName = params.get("shortName") || "海老名";
  const fullName = params.get("fullName") || "海老名SA";
  const types = (params.get("types") || "SA").split(",").filter(Boolean);
  const km = params.get("km") || "";
  const facilityWiki = params.get("wiki") || fullName;

  const isSapa = types.includes("SA") || types.includes("PA");
  const primaryBadge = types[0] || "IC";

  // タイトルプレート名：既に種別サフィックスが含まれていればそのまま、無ければ shortName + primaryBadge（重複防止）
  const hasSuffix = /(IC|JCT|SA|PA|SIC|BS|TB|TN|インターチェンジ|ジャンクション|サービスエリア|パーキングエリア|バスストップ)$/i.test(fullName);
  const plateLabel = hasSuffix ? fullName : `${shortName}${primaryBadge}`;

  document.title = `${routeNum} ${plateLabel} - 高速道路Wikipediaガイド`;
  document.getElementById("facilityRouteNum").textContent = routeNum;
  document.getElementById("facilityTitleName").textContent = plateLabel;

  const detailTabBtn = document.getElementById("facilityDetailTabBtn");
  detailTabBtn.textContent = isSapa ? "施設" : "接続道路・詳細";

  const backBtn = document.getElementById("backToRouteBtn");
  backBtn.addEventListener("click", () => {
    const rParams = new URLSearchParams({
      num: routeNum,
      name: routeName,
      wiki: routeWiki,
      tab: "interchanges"
    });
    location.href = `route.html?${rParams.toString()}`;
  });

  // 前後の施設 ＆ 同じ行の併設施設（例：米原IC と 北陸米原BS）＆ 接続高速道路を取得
  let adjacent = { prev: null, next: null };
  let currentRowItem = null;
  try {
    const savedList = JSON.parse(sessionStorage.getItem("hw_current_ic_list") || "[]");
    if (currentIndex >= 0 && savedList.length > 0) {
      currentRowItem = savedList[currentIndex] || null;
      if (currentIndex > 0) adjacent.prev = { index: currentIndex - 1, ...savedList[currentIndex - 1] };
      if (currentIndex < savedList.length - 1) adjacent.next = { index: currentIndex + 1, ...savedList[currentIndex + 1] };
    }
  } catch (_) {}

  let activeSection = "detail";
  let displayMode = "original";
  let parsedFacility = null;

  const navItems = document.querySelectorAll(".sidebar-nav .nav-item");
  const modeBtns = document.querySelectorAll(".display-mode-buttons .mode-btn");
  const mainContent = document.getElementById("facilityMainContent");
  const sourceLink = document.getElementById("wikiFacilitySourceLink");

  function render() {
    if (!parsedFacility) return;

    navItems.forEach(b => b.classList.toggle("active", b.dataset.tab === activeSection));
    modeBtns.forEach(b => b.classList.toggle("active", b.dataset.mode === displayMode));

    if (displayMode === "raw") {
      mainContent.innerHTML = `<div class="raw-wiki-container">${parsedFacility.rawHtml}</div>`;
      return;
    }

    // 併設施設切替バー（例：米原IC と 北陸米原BS が同じ行にある場合）
    let coFacilitiesHtml = "";
    if (currentRowItem && Array.isArray(currentRowItem.badgeItems) && currentRowItem.badgeItems.length > 1) {
      const chips = currentRowItem.badgeItems.map(b => {
        const isCurrent = b.type === primaryBadge && b.wikiTitle === facilityWiki;
        return `
          <button type="button"
                  class="co-facility-chip ${isCurrent ? "active" : ""}"
                  data-co-wiki="${WikiRenderer.escapeHtml(b.wikiTitle)}"
                  data-co-type="${WikiRenderer.escapeHtml(b.type)}"
                  data-co-label="${WikiRenderer.escapeHtml(b.label)}"
                  data-co-short="${WikiRenderer.escapeHtml(b.shortName || "")}"
                  ${isCurrent ? "disabled" : ""}>
            ${WikiRenderer.renderFacilityBadges([b.type])}
            <span>${WikiRenderer.escapeHtml(b.label)}</span>
          </button>
        `;
      }).join("");
      coFacilitiesHtml = `
        <div class="co-facilities-bar">
          <span>併設施設：</span>
          ${chips}
        </div>
      `;
    }

    // 概要セクションHTML
    const overviewSectionHtml = `
      <section id="sec-facility-overview" class="facility-unified-section">
        <div class="facility-section-banner">
          <span class="facility-section-tag">OVERVIEW</span>
          <h2>概要・基本データ</h2>
        </div>
        ${WikiRenderer.renderOverviewTab(parsedFacility.overview, plateLabel)}
      </section>
    `;

    // 施設（または接続道路・詳細）セクションHTML
    let detailBodyHtml = "";
    if (parsedFacility.isSapa) {
      const dirs = parsedFacility.sapaDirections;
      if (!dirs || dirs.length === 0) {
        detailBodyHtml = `
          <div class="notice-banner">このSA/PAの施設一覧を自動抽出できなかったため、原文を表示しています。</div>
          <div class="raw-wiki-container">${parsedFacility.rawHtml}</div>
        `;
      } else {
        detailBodyHtml = dirs.map(d => WikiRenderer.renderSapaDirection(d)).join("");
      }
    } else {
      const fallbackHwLinks = currentRowItem ? (currentRowItem.connectLinks || []) : [];
      detailBodyHtml = WikiRenderer.renderIcJctDetail(
        parsedFacility.icDetail,
        { num, shortName, name: plateLabel, types, km },
        adjacent,
        fallbackHwLinks
      );
    }

    const detailSectionHtml = `
      <section id="sec-facility-detail" class="facility-unified-section">
        <div class="facility-section-banner">
          <span class="facility-section-tag">${parsedFacility.isSapa ? "FACILITIES" : "DETAILS"}</span>
          <h2>${parsedFacility.isSapa ? "施設・駐車場・店舗一覧" : "接続道路・詳細"}</h2>
        </div>
        ${coFacilitiesHtml}
        ${detailBodyHtml}
      </section>
    `;

    // 1ページに「施設」と「概要」をまとめて連続表示
    mainContent.innerHTML = `
      ${detailSectionHtml}
      <hr class="facility-unified-divider" />
      ${overviewSectionHtml}
    `;

    // 併設施設チップクリックで切り替え
    mainContent.querySelectorAll(".co-facility-chip:not(.active)").forEach(chip => {
      chip.addEventListener("click", () => {
        const nextParams = new URLSearchParams({
          routeNum,
          routeName,
          routeWiki,
          index: String(currentIndex),
          num,
          shortName: chip.dataset.coShort || shortName,
          fullName: chip.dataset.coLabel,
          types: chip.dataset.coType,
          km,
          wiki: chip.dataset.coWiki
        });
        location.href = `facility.html?${nextParams.toString()}`;
      });
    });

    // JCT/IC詳細画面内の「接続する道路」高速道路カードクリックで該当高速道路ページへ移動
    mainContent.querySelectorAll(".clickable-hw-card").forEach(card => {
      const goHw = () => {
        navigateToHighwayRoute({
          num: card.dataset.hwNum,
          name: card.dataset.hwName,
          wikiTitle: card.dataset.hwWiki
        });
      };
      card.addEventListener("click", goHw);
      card.addEventListener("keydown", e => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          goHw();
        }
      });
    });

    if (!parsedFacility.isSapa) {
      const goAdj = (adjItem) => {
        if (!adjItem) return;
        const primary = adjItem.primaryBadge || (adjItem.badgeItems && adjItem.badgeItems[0]);
        const nextParams = new URLSearchParams({
          routeNum,
          routeName,
          routeWiki,
          index: String(adjItem.index),
          num: adjItem.num,
          shortName: (primary && primary.shortName) ? primary.shortName : adjItem.shortName,
          fullName: primary ? primary.label : adjItem.fullName,
          types: primary ? primary.type : (adjItem.types[0] || "IC"),
          km: adjItem.km,
          wiki: primary ? primary.wikiTitle : adjItem.wikiTitle
        });
        location.href = `facility.html?${nextParams.toString()}`;
      };

      const prevBtn = document.getElementById("prevFacilityBtn");
      const nextBtn = document.getElementById("nextFacilityBtn");
      if (prevBtn && adjacent.prev) prevBtn.addEventListener("click", () => goAdj(adjacent.prev));
      if (nextBtn && adjacent.next) nextBtn.addEventListener("click", () => goAdj(adjacent.next));
    }
  }

  navItems.forEach(btn => {
    btn.addEventListener("click", () => {
      activeSection = btn.dataset.tab;
      if (displayMode === "raw") {
        displayMode = "original";
        render();
      } else {
        navItems.forEach(b => b.classList.toggle("active", b.dataset.tab === activeSection));
      }
      const targetId = activeSection === "overview" ? "sec-facility-overview" : "sec-facility-detail";
      const targetEl = document.getElementById(targetId);
      if (targetEl) {
        targetEl.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  });

  modeBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      displayMode = btn.dataset.mode;
      render();
    });
  });

  try {
    const pageData = await WikiAPI.fetchPageHtml(facilityWiki);
    sourceLink.href = pageData.wikiUrl;
    parsedFacility = WikiParser.parseFacilityPage(pageData.html, isSapa);
    render();
  } catch (err) {
    mainContent.innerHTML = `
      <div class="notice-banner" style="background:#ffebee; border-color:#ef9a9a; color:#b71c1c;">
        Wikipedia記事「${WikiRenderer.escapeHtml(facilityWiki)}」の取得に失敗しました（未開通・事業中・バス停留所などで単独記事がまだ存在しない可能性があります）。
      </div>
    `;
  }
}
