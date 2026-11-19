/* =========================================================
   renderer.js : 高速道路標識風UIコンポーネント・SVG地図描画
   ========================================================= */

const WikiRenderer = (() => {
  const BADGE_CLASS_MAP = {
    IC: "badge-ic",
    JCT: "badge-jct",
    SA: "badge-sa",
    PA: "badge-pa",
    SIC: "badge-sic",
    BS: "badge-bs",
    TB: "badge-tb",
    TN: "badge-tn"
  };

  const BADGE_LABEL_MAP = {
    IC: "IC",
    JCT: "JCT",
    SA: "SA",
    PA: "PA",
    SIC: "SIC",
    BS: "BS",
    TB: "TB",
    TN: "TN"
  };

  function escapeHtml(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  /**
   * 施設種別アイコンバッジ群を生成（複数併設時は個別クリック可能）
   */
  function renderFacilityBadges(types, badgeItems = null, interactive = false) {
    const safeTypes = Array.isArray(types) && types.length > 0 ? types : ["IC"];
    const items = Array.isArray(badgeItems) && badgeItems.length > 0
      ? badgeItems
      : safeTypes.map(t => ({ type: t, wikiTitle: "", label: "", shortName: "", isInactive: false }));

    const badgesHtml = items.map(item => {
      const t = item.type;
      const cls = BADGE_CLASS_MAP[t] || "badge-ic";
      const label = BADGE_LABEL_MAP[t] || t;
      const inactiveCls = item.isInactive ? " f-badge-inactive" : "";
      if (interactive && item.wikiTitle) {
        const statusSuffix = item.isInactive ? "（事業中・未開通/廃止）" : "";
        return `<span class="f-badge ${cls}${inactiveCls} clickable-badge"
                      role="button"
                      tabindex="0"
                      data-wiki="${escapeHtml(item.wikiTitle)}"
                      data-type="${escapeHtml(t)}"
                      data-label="${escapeHtml(item.label || "")}"
                      data-short="${escapeHtml(item.shortName || "")}"
                      title="${escapeHtml((item.label || t) + statusSuffix)} の詳細を見る">${escapeHtml(label)}</span>`;
      }
      return `<span class="f-badge ${cls}${inactiveCls}">${escapeHtml(label)}</span>`;
    }).join("");

    return `<span class="facility-badges">${badgesHtml}</span>`;
  }

  /**
   * トップ画面の日本地図＆幹線高速道路ネットワークSVGを描画
   */
  function renderJapanMap(container, routes, selectedRegion, onSelectRegion, onSelectRoute) {
    if (!container) return;
    const safeRoutes = Array.isArray(routes) ? routes : [];

    const regions = [
      { id: "hokkaido", name: "北海道", points: "338,108 345,78 362,55 375,20 402,28 432,58 424,84 395,92 372,88 352,110", lx: 382, ly: 62 },
      { id: "tohoku",   name: "東北",   points: "326,118 352,118 358,162 348,215 342,240 314,240 318,185", lx: 335, ly: 175 },
      { id: "kanto",    name: "関東",   points: "300,240 342,240 348,282 326,306 298,302 296,268", lx: 320, ly: 272 },
      { id: "chubu",    name: "中部",   points: "224,265 268,220 300,240 298,302 268,318 228,314 222,290", lx: 258, ly: 274 },
      { id: "kinki",    name: "近畿",   points: "178,282 224,265 228,314 214,344 184,342 176,315", lx: 202, ly: 310 },
      { id: "chugoku",  name: "中国",   points: "96,298 178,282 176,315 100,326", lx: 138, ly: 306 },
      { id: "shikoku",  name: "四国",   points: "120,334 176,328 174,362 118,364", lx: 147, ly: 348 },
      { id: "kyushu",   name: "九州",   points: "46,326 96,326 94,385 72,424 44,412 40,362", lx: 68, ly: 372 }
    ];

    const regionPolysHtml = regions.map(reg => {
      const isActive = selectedRegion === reg.id;
      return `
        <g class="map-region-group" data-region="${reg.id}">
          <polygon class="region-shape ${isActive ? "active" : ""}" points="${reg.points}"></polygon>
          <text x="${reg.lx}" y="${reg.ly}" text-anchor="middle" font-size="11" font-weight="800" fill="#23472e" pointer-events="none">${reg.name}</text>
        </g>
      `;
    }).join("");

    const routeLinesHtml = safeRoutes
      .filter(r => Array.isArray(r.mapCoords) && r.mapCoords.length >= 2)
      .map(r => {
        const pts = r.mapCoords.map(c => `${c[0]},${c[1]}`).join(" ");
        const strokeColor = r.color || "#1b7837";
        const rName = r.name || r.wikiTitle || r.id;
        return `
          <polyline class="map-route-line"
                    data-route-id="${escapeHtml(r.id)}"
                    points="${pts}"
                    stroke="${escapeHtml(strokeColor)}">
            <title>${escapeHtml((r.number || "") + " " + rName)}</title>
          </polyline>
        `;
      }).join("");

    container.innerHTML = `
      <svg class="japan-map-svg" viewBox="0 0 450 445" role="img" aria-label="日本全国の高速道路ネットワークマップ">
        ${regionPolysHtml}
        ${routeLinesHtml}
      </svg>
    `;

    container.querySelectorAll(".map-region-group").forEach(grp => {
      grp.addEventListener("click", () => {
        if (typeof onSelectRegion === "function") {
          onSelectRegion(grp.dataset.region);
        }
      });
    });

    container.querySelectorAll(".map-route-line").forEach(line => {
      line.addEventListener("click", e => {
        e.stopPropagation();
        if (typeof onSelectRoute === "function") {
          onSelectRoute(line.dataset.routeId);
        }
      });
    });
  }

  /**
   * 概要タブ（リード文 ＋ Infobox基礎データ）を描画
   */
  function renderOverviewTab(overview, titleName) {
    const paragraphs = (overview && Array.isArray(overview.paragraphs)) ? overview.paragraphs : [];
    const infobox = (overview && Array.isArray(overview.infobox)) ? overview.infobox : [];

    const paraHtml = paragraphs.length > 0
      ? paragraphs.map(p => `<p>${escapeHtml(p)}</p>`).join("")
      : `<p>${escapeHtml(titleName)} のWikipedia記事データです。</p>`;

    const infoHtml = infobox.length > 0
      ? `
        <div class="infobox-grid">
          ${infobox.map(row => `
            <div class="infobox-item">
              <div class="infobox-key">${escapeHtml(row.key)}</div>
              <div class="infobox-val">${escapeHtml(row.val)}</div>
            </div>
          `).join("")}
        </div>
      `
      : "";

    return `
      <div class="overview-card">
        <h2>${escapeHtml(titleName)} の概要</h2>
        ${paraHtml}
        ${infoHtml}
      </div>
    `;
  }

  /**
   * 車線数ビジュアル（上り・下りの縦棒＋テキスト）を描画
   */
  function renderLanesVisual(upLanes, downLanes) {
    const up = Math.max(1, Math.min(5, Number(upLanes) || 2));
    const down = Math.max(1, Math.min(5, Number(downLanes) || 2));

    const upBars = Array.from({ length: up }, () => `<span class="lane-bar"></span>`).join("");
    const downBars = Array.from({ length: down }, () => `<span class="lane-bar"></span>`).join("");

    return `
      <div class="lanes-visual-box">
        <div class="lanes-bars" aria-hidden="true">
          ${upBars}
          <span class="lane-bar median"></span>
          ${downBars}
        </div>
        <div class="lanes-text">
          <div>上り ${up}車線</div>
          <div>下り ${down}車線</div>
        </div>
      </div>
    `;
  }

  /**
   * 最高速度標識アイコン群を描画
   */
  function renderSpeedSigns(speeds) {
    if (!Array.isArray(speeds) || speeds.length === 0) {
      return `<span style="color:#777; font-size:13px;">（同上）</span>`;
    }
    return `
      <div class="speed-signs-group">
        ${speeds.map(s => `
          <div class="speed-sign-item">
            <span class="speed-sign-label">${escapeHtml(s.label)}</span>
            <div class="speed-sign-circle">${escapeHtml(s.speed)}</div>
          </div>
        `).join("")}
      </div>
    `;
  }

  /**
   * SA/PA の方向別施設ボックスを描画
   */
  function renderSapaDirection(dir) {
    const parkingParts = [];
    if (dir.largeParking) parkingParts.push(`大型 ${dir.largeParking}`);
    if (dir.smallParking) parkingParts.push(`小型 ${dir.smallParking}`);
    if (dir.handicappedParking) parkingParts.push(`身障者用 ${dir.handicappedParking}`);
    if (parkingParts.length === 0 && dir.totalParking) parkingParts.push(`計 ${dir.totalParking}`);

    const parkingHtml = parkingParts.length > 0 ? `
      <div class="parking-block">
        <div class="parking-p-icon">P</div>
        <div class="parking-counts">${parkingParts.map(p => escapeHtml(p)).join(" / ")}</div>
      </div>
    ` : "";

    const amenities = [];
    if (dir.hasToilet) amenities.push({ label: "トイレ", icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="5" r="2"/><path d="M6 21v-7H5v-4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v4h-1v7"/><circle cx="17" cy="5" r="2"/><path d="M15 21v-5h-1l2-7h2l2 7h-1v5"/></svg>` });
    if (dir.hasGs) amenities.push({ label: "給油所", icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="4" width="10" height="16" rx="2"/><path d="M14 8h3l2 3v7a1 1 0 0 1-2 0v-5h-3"/></svg>` });
    if (dir.hasEv) amenities.push({ label: "EV充電", icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>` });
    if (dir.hasInfo) amenities.push({ label: "案内所", icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>` });
    if (dir.hasVending) amenities.push({ label: "自販機", icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="3" width="14" height="18" rx="2"/><line x1="9" y1="8" x2="15" y2="8"/></svg>` });

    const amenityHtml = amenities.length > 0 ? `
      <div class="amenity-icons-row">
        ${amenities.map(a => `
          <div class="amenity-icon-card">
            ${a.icon}
            <span>${a.label}</span>
          </div>
        `).join("")}
      </div>
    ` : "";

    const gpList = Array.isArray(dir.generalParking) ? dir.generalParking : [];
    const generalParkingHtml = gpList.length > 0 ? `
      <div class="general-parking-row">
        ${gpList.map(gp => {
          const parts = [];
          if (gp.large) parts.push(`大型 ${gp.large}`);
          if (gp.small) parts.push(`小型 ${gp.small}`);
          if (gp.handicapped) parts.push(`身障者用 ${gp.handicapped}`);
          if (parts.length === 0 && gp.total) parts.push(`計 ${gp.total}`);
          return `
            <div class="general-parking-item">
              <div class="general-parking-p-icon">P</div>
              <div>
                <div class="general-parking-label">${escapeHtml(gp.label)}</div>
                <div class="general-parking-counts">${escapeHtml(parts.join(" / "))}</div>
              </div>
            </div>
          `;
        }).join("")}
      </div>
    ` : "";

    const categoriesHtml = (dir.categories && dir.categories.length > 0) ? `
      <div class="sapa-sub-heading">店舗・フード・ショッピング</div>
      <div class="sapa-categories-grid">
        ${dir.categories.map(cat => `
          <div class="sapa-category-card">
            <div class="sapa-cat-header">
              <div class="sapa-cat-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-6 9 6v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>
              </div>
              <div>
                <div class="sapa-cat-title">${escapeHtml(cat.title)}</div>
                ${cat.is24h ? `<span class="sapa-cat-badge-24h">24時間営業</span>` : ""}
              </div>
            </div>
            ${cat.items && cat.items.length > 0 ? `
              <ul class="sapa-shop-list">
                ${cat.items.map(it => `<li>${escapeHtml(it)}</li>`).join("")}
              </ul>
            ` : ""}
          </div>
        `).join("")}
      </div>
    ` : "";

    const othersHtml = (dir.others && dir.others.length > 0) ? `
      <div class="sapa-sub-heading">その他設備</div>
      <div class="sapa-others-list">
        ${dir.others.map(o => `<span class="sapa-other-chip">${escapeHtml(o)}</span>`).join("")}
      </div>
    ` : "";

    return `
      <section class="sapa-section-box">
        <h3 class="sapa-direction-title">${escapeHtml(dir.title)}</h3>
        ${(parkingHtml || amenityHtml) ? `<div class="sapa-top-metrics">${parkingHtml}${amenityHtml}</div>` : ""}
        ${generalParkingHtml}
        ${categoriesHtml}
        ${othersHtml}
      </section>
    `;
  }

  /**
   * IC / JCT / SIC / BS 等の詳細ボックスを描画
   */
  function renderIcJctDetail(icDetail, info, adjacent, fallbackHwLinks = []) {
    const roads = (icDetail && Array.isArray(icDetail.connectedRoads)) ? icDetail.connectedRoads : [];
    const historyItems = (icDetail && Array.isArray(icDetail.historyItems)) ? icDetail.historyItems : [];

    let roadsHtml = "";
    if (roads.length > 0) {
      roadsHtml = roads.map(r => {
        if (r.kind === "highway") {
          return `
            <div class="connected-road-card clickable-hw-card"
                 role="button"
                 tabindex="0"
                 data-hw-num="${escapeHtml(r.num || "HW")}"
                 data-hw-name="${escapeHtml(r.hwName || r.name)}"
                 data-hw-wiki="${escapeHtml(r.wikiTitle || r.hwName || r.name)}">
              <div class="connected-road-left">
                <span class="route-num-badge">${escapeHtml(r.num || "HW")}</span>
                <span>${escapeHtml(r.name)}</span>
              </div>
              <span class="hw-jump-arrow">路線ページへ ↗</span>
            </div>
          `;
        }
        return `
          <div class="connected-road-card">
            ${r.num ? `<span class="operator-tag">${escapeHtml(r.kind === "national" ? "国道" + r.num + "号" : "県道" + r.num + "号")}</span>` : ""}
            <span>${escapeHtml(r.name)}</span>
          </div>
        `;
      }).join("");
    } else if (Array.isArray(fallbackHwLinks) && fallbackHwLinks.length > 0) {
      roadsHtml = fallbackHwLinks.map(lk => `
        <div class="connected-road-card clickable-hw-card"
             role="button"
             tabindex="0"
             data-hw-num="${escapeHtml(lk.num || "HW")}"
             data-hw-name="${escapeHtml(lk.name || lk.wikiTitle)}"
             data-hw-wiki="${escapeHtml(lk.wikiTitle || lk.name)}">
          <div class="connected-road-left">
            <span class="route-num-badge">${escapeHtml(lk.num || "HW")}</span>
            <span>${escapeHtml(lk.name || lk.wikiTitle)}</span>
          </div>
          <span class="hw-jump-arrow">路線ページへ ↗</span>
        </div>
      `).join("");
    } else {
      roadsHtml = `<p style="color:#666; font-size:14px;">接続道路の箇条書きデータはありません。</p>`;
    }

    const historyHtml = historyItems.length > 0 ? `
      <div style="margin-top:22px;">
        <h3 class="sapa-sub-heading">沿革・歴史</h3>
        <ul class="sapa-shop-list">
          ${historyItems.map(h => `<li>${escapeHtml(h)}</li>`).join("")}
        </ul>
      </div>
    ` : "";

    const prevCard = adjacent && adjacent.prev
      ? `
        <div id="prevFacilityBtn" class="adjacent-card" role="button" tabindex="0">
          <div class="adjacent-dir-label">◀ 起点側（前の施設）</div>
          <div class="adjacent-facility-name">${escapeHtml(adjacent.prev.fullName || adjacent.prev.shortName)}</div>
        </div>
      `
      : `<div class="adjacent-card disabled"><div class="adjacent-dir-label">◀ 起点側</div><div class="adjacent-facility-name">なし</div></div>`;

    const nextCard = adjacent && adjacent.next
      ? `
        <div id="nextFacilityBtn" class="adjacent-card" role="button" tabindex="0" style="text-align:right;">
          <div class="adjacent-dir-label">終点側（次の施設） ▶</div>
          <div class="adjacent-facility-name">${escapeHtml(adjacent.next.fullName || adjacent.next.shortName)}</div>
        </div>
      `
      : `<div class="adjacent-card disabled" style="text-align:right;"><div class="adjacent-dir-label">終点側 ▶</div><div class="adjacent-facility-name">なし</div></div>`;

    return `
      <section class="ic-detail-box">
        <div class="ic-detail-hero">
          ${info.num && info.num !== "-" ? `<span class="ic-detail-num">[${escapeHtml(info.num)}]</span>` : ""}
          ${renderFacilityBadges(info.types)}
          <h3 class="ic-detail-name">${escapeHtml(info.name)}</h3>
          ${info.km ? `<span class="ic-detail-km-pill">起点から ${escapeHtml(info.km)}</span>` : ""}
        </div>

        <h4 class="sapa-sub-heading">接続する道路</h4>
        <div class="connected-roads-list">
          ${roadsHtml}
        </div>

        ${historyHtml}

        <div class="adjacent-nav-grid">
          ${prevCard}
          ${nextCard}
        </div>
      </section>
    `;
  }

  return {
    escapeHtml,
    renderFacilityBadges,
    renderJapanMap,
    renderOverviewTab,
    renderLanesVisual,
    renderSpeedSigns,
    renderSapaDirection,
    renderIcJctDetail
  };
})();
