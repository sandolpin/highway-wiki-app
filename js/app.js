/* =========================================================
   app.js : 各画面の初期化・イベント制御・画面遷移
   ========================================================= */

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
    // マップ再描画
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

    // フィルタリング
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
      const go = () => {
        const rt = routes.find(x => x.id === card.dataset.id);
        if (rt) navigateToRoute(rt);
      };
      card.addEventListener("click", go);
      card.addEventListener("keydown", e => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          go();
        }
      });
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
    const params = new URLSearchParams({
      id: "custom",
      num: "HW",
      name: title,
      wiki: title
    });
    location.href = `route.html?${params.toString()}`;
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

  let parsedData = null;

  function updateTabUI() {
    navItems.forEach(btn => {
      btn.classList.toggle("active", btn.dataset.tab === activeTab);
    });
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

      // 施設詳細画面で「前の施設・次の施設」移動ができるよう一覧を保存
      sessionStorage.setItem("hw_current_ic_list", JSON.stringify(list));

      const rowsHtml = list.map((item, idx) => `
        <div class="ic-row-card" data-index="${idx}" role="button" tabindex="0">
          <div class="ic-col-num">${WikiRenderer.escapeHtml(item.num)}</div>
          <div class="ic-col-name">
            ${WikiRenderer.renderFacilityBadges(item.types)}
            <span>${WikiRenderer.escapeHtml(item.shortName)}</span>
          </div>
          <div class="ic-col-km">${WikiRenderer.escapeHtml(item.km)}</div>
          <div class="ic-col-note">${WikiRenderer.escapeHtml(item.note)}</div>
          <div class="ic-col-connect">${WikiRenderer.escapeHtml(item.connect)}</div>
        </div>
      `).join("");

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
        const openFacility = () => {
          const idx = Number(row.dataset.index);
          const item = list[idx];
          if (!item) return;
          const fParams = new URLSearchParams({
            routeNum,
            routeName,
            routeWiki: wikiTitle,
            index: String(idx),
            num: item.num,
            shortName: item.shortName,
            fullName: item.fullName,
            types: item.types.join(","),
            km: item.km,
            wiki: item.wikiTitle
          });
          location.href = `facility.html?${fParams.toString()}`;
        };
        row.addEventListener("click", openFacility);
        row.addEventListener("keydown", e => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            openFacility();
          }
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
   3. 施設詳細画面 (facility.html : PA/SA & IC/JCT 両対応)
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
  const plateLabel = `${shortName}${primaryBadge}`;

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

  // 前後の施設情報取得
  let adjacent = { prev: null, next: null };
  try {
    const savedList = JSON.parse(sessionStorage.getItem("hw_current_ic_list") || "[]");
    if (currentIndex >= 0 && savedList.length > 0) {
      if (currentIndex > 0) adjacent.prev = { index: currentIndex - 1, ...savedList[currentIndex - 1] };
      if (currentIndex < savedList.length - 1) adjacent.next = { index: currentIndex + 1, ...savedList[currentIndex + 1] };
    }
  } catch (_) {}

  let activeTab = "detail"; // "overview" | "detail"
  let displayMode = "original"; // "original" | "raw"
  let parsedFacility = null;

  const navItems = document.querySelectorAll(".sidebar-nav .nav-item");
  const modeBtns = document.querySelectorAll(".display-mode-buttons .mode-btn");
  const mainContent = document.getElementById("facilityMainContent");
  const sourceLink = document.getElementById("wikiFacilitySourceLink");

  function render() {
    if (!parsedFacility) return;

    navItems.forEach(b => b.classList.toggle("active", b.dataset.tab === activeTab));
    modeBtns.forEach(b => b.classList.toggle("active", b.dataset.mode === displayMode));

    if (displayMode === "raw") {
      mainContent.innerHTML = `<div class="raw-wiki-container">${parsedFacility.rawHtml}</div>`;
      return;
    }

    if (activeTab === "overview") {
      mainContent.innerHTML = WikiRenderer.renderOverviewTab(parsedFacility.overview, plateLabel);
      return;
    }

    // オリジナル描画モード（詳細タブ）
    if (parsedFacility.isSapa) {
      const dirs = parsedFacility.sapaDirections;
      if (!dirs || dirs.length === 0) {
        mainContent.innerHTML = `
          <div class="notice-banner">このSA/PAの施設一覧を自動抽出できなかったため、原文を表示しています。</div>
          <div class="raw-wiki-container">${parsedFacility.rawHtml}</div>
        `;
        return;
      }
      mainContent.innerHTML = dirs.map(d => WikiRenderer.renderSapaDirection(d)).join("");
    } else {
      mainContent.innerHTML = WikiRenderer.renderIcJctDetail(
        parsedFacility.icDetail,
        { num, shortName, name: fullName, types, km },
        adjacent
      );

      const goAdj = (adjItem) => {
        if (!adjItem) return;
        const nextParams = new URLSearchParams({
          routeNum,
          routeName,
          routeWiki,
          index: String(adjItem.index),
          num: adjItem.num,
          shortName: adjItem.shortName,
          fullName: adjItem.fullName,
          types: adjItem.types.join(","),
          km: adjItem.km,
          wiki: adjItem.wikiTitle
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
      activeTab = btn.dataset.tab;
      render();
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
        Wikipedia記事「${WikiRenderer.escapeHtml(facilityWiki)}」の取得に失敗しました（未開通・事業中などで単独記事がまだ存在しない可能性があります）。
      </div>
    `;
  }
}
