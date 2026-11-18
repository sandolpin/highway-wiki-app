/* =========================================================
   renderer.js : オリジナル描画（簡易マップ・車線・標識・SA/PA・IC/JCT）
   ========================================================= */

const WikiRenderer = (() => {
  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /**
   * 施設種別バッジ（IC / JCT / PA / SA / SIC / BS 等）のHTML生成
   */
  function renderFacilityBadges(types, badgeItems = null, clickable = false) {
    const validClasses = ["ic", "jct", "sa", "pa", "sic", "bs", "tb", "tn"];

    if (Array.isArray(badgeItems) && badgeItems.length > 0) {
      const badgesHtml = badgeItems.map(b => {
        const lower = (b.type || "").toLowerCase();
        const cls = validClasses.includes(lower) ? lower : "other";
        const clickCls = clickable ? "clickable-badge" : "";
        const dataAttrs = clickable
          ? `data-wiki="${escapeHtml(b.wikiTitle)}" data-type="${escapeHtml(b.type)}" data-label="${escapeHtml(b.label)}" data-short="${escapeHtml(b.shortName || "")}" title="${escapeHtml(b.label)} の詳細へ移動"`
          : "";
        return `<span class="f-badge ${cls} ${clickCls}" ${dataAttrs}>${escapeHtml(b.type)}</span>`;
      }).join("");
      return `<span class="facility-badges">${badgesHtml}</span>`;
    }

    const list = Array.isArray(types) && types.length > 0 ? types : ["IC"];
    const badgesHtml = list.map(t => {
      const lower = t.toLowerCase();
      const cls = validClasses.includes(lower) ? lower : "other";
      return `<span class="f-badge ${cls}">${escapeHtml(t)}</span>`;
    }).join("");
    return `<span class="facility-badges">${badgesHtml}</span>`;
  }

  /**
   * 路線状況：車線数グラフィック描画
   */
  function renderLanesVisual(upLanes, downLanes) {
    const makeBlock = (count) => {
      const safeCount = Math.max(1, Math.min(6, Number(count) || 2));
      const strips = Array.from({ length: safeCount }, () => `<span class="lane-strip"></span>`).join("");
      return `
        <div class="lane-direction-block">
          <div class="lane-road-box">${strips}</div>
          <span class="lane-count-num">${safeCount}</span>
        </div>
      `;
    };
    return `
      <div class="lanes-visual-group">
        ${makeBlock(upLanes)}
        ${makeBlock(downLanes)}
      </div>
    `;
  }

  /**
   * 路線状況：最高速度標識描画
   */
  function renderSpeedSigns(speeds) {
    if (!speeds || speeds.length === 0) return "";
    const items = speeds.map(s => `
      <div class="speed-sign-item">
        <span class="speed-sign-label">${escapeHtml(s.label)}</span>
        <span class="speed-sign-circle">${escapeHtml(s.speed)}</span>
      </div>
    `).join("");
    return `<div class="speed-signs-group">${items}</div>`;
  }

  /**
   * SA / PA 画面：方面別の駐車台数（本線＋一般道ぷらっとパーク分離）・ピクトグラム・店舗リスト描画
   */
  function renderSapaDirection(dir) {
    const truckSvg = `<svg viewBox="0 0 24 24"><rect x="1" y="6" width="14" height="10" rx="1.5"></rect><path d="M15 9h4l3 3v4h-7V9z"></path><circle cx="6" cy="18" r="2"></circle><circle cx="18" cy="18" r="2"></circle></svg>`;
    const carSvg = `<svg viewBox="0 0 24 24"><path d="M5 11l2-5h10l2 5"></path><rect x="3" y="11" width="18" height="6" rx="2"></rect><circle cx="7" cy="18" r="2"></circle><circle cx="17" cy="18" r="2"></circle></svg>`;

    const hasMainParking = dir.largeParking || dir.smallParking || dir.totalParking || dir.handicappedParking;
    const hasGenParking = Array.isArray(dir.generalParking) && dir.generalParking.length > 0;

    let parkingHtml = "";
    if (hasMainParking || hasGenParking) {
      const mainRowHtml = hasMainParking ? `
        <div class="parking-sub-group">
          ${hasGenParking ? `<span class="parking-group-badge main-hw">本線駐車枠</span>` : ""}
          ${dir.largeParking ? `
            <div class="parking-card" title="大型車駐車台数">
              ${truckSvg}
              <span>${escapeHtml(dir.largeParking)}</span>
            </div>
          ` : ""}
          ${dir.smallParking ? `
            <div class="parking-card" title="小型車駐車台数">
              ${carSvg}
              <span>${escapeHtml(dir.smallParking)}</span>
            </div>
          ` : ""}
          ${(!dir.largeParking && !dir.smallParking && dir.totalParking) ? `
            <div class="parking-card" title="駐車台数">
              ${carSvg}
              <span>計 ${escapeHtml(dir.totalParking)}</span>
            </div>
          ` : ""}
          ${dir.handicappedParking ? `
            <div class="parking-card" title="身障者用駐車台数">
              <span style="font-size:13px; color:#555;">身障者用</span>
              <span>${escapeHtml(dir.handicappedParking)}</span>
            </div>
          ` : ""}
        </div>
      ` : "";

      const genRowsHtml = hasGenParking ? dir.generalParking.map(gp => `
        <div class="parking-sub-group">
          <span class="parking-group-badge general-road">${escapeHtml(gp.label || "一般道（ぷらっとパーク）")}</span>
          ${gp.large ? `
            <div class="parking-card general-road-card" title="${escapeHtml(gp.label)} 大型車">
              ${truckSvg}
              <span>${escapeHtml(gp.large)}</span>
            </div>
          ` : ""}
          ${gp.small ? `
            <div class="parking-card general-road-card" title="${escapeHtml(gp.label)} 小型車">
              ${carSvg}
              <span>${escapeHtml(gp.small)}</span>
            </div>
          ` : ""}
          ${(!gp.large && !gp.small && gp.total) ? `
            <div class="parking-card general-road-card" title="${escapeHtml(gp.label)} 駐車台数">
              ${carSvg}
              <span>${escapeHtml(gp.total)}</span>
            </div>
          ` : ""}
        </div>
      `).join("") : "";

      parkingHtml = `
        <div class="parking-section-group">
          ${mainRowHtml}
          ${genRowsHtml}
        </div>
      `;
    }

    const amenities = [];
    if (dir.hasToilet) {
      amenities.push(`
        <div class="amenity-icon-box" title="トイレ">
          <svg viewBox="0 0 24 24" fill="currentColor">
            <circle cx="8" cy="5" r="2"></circle><path d="M6 9h4v6H9v5H7v-5H6V9z"></path>
            <circle cx="16" cy="5" r="2"></circle><path d="M14 9h4l1 6h-2v5h-2v-5h-2l1-6z"></path>
          </svg>
        </div>
      `);
    }
    if (dir.hasEv) {
      amenities.push(`
        <div class="amenity-icon-box ev" title="EV急速充電器">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M5 11l2-4h10l2 4"></path><rect x="3" y="11" width="18" height="6" rx="2"></rect>
            <path d="M13 13l-2 2h3l-2 2" stroke-width="1.8"></path>
          </svg>
        </div>
      `);
    }
    if (dir.hasGs) {
      amenities.push(`
        <div class="amenity-icon-box gs" title="ガソリンスタンド">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="4" y="4" width="10" height="16" rx="1.5"></rect>
            <rect x="6" y="6" width="6" height="4"></rect>
            <path d="M14 8h2a2 2 0 0 1 2 2v7a1.5 1.5 0 0 0 3 0v-6l-2-2"></path>
          </svg>
        </div>
      `);
    }
    if (dir.hasInfo) {
      amenities.push(`
        <div class="amenity-icon-box info" title="インフォメーション">
          <svg viewBox="0 0 24 24" fill="currentColor">
            <circle cx="12" cy="7" r="1.6"></circle><rect x="10.7" y="10.5" width="2.6" height="7.5" rx="1"></rect>
          </svg>
        </div>
      `);
    }
    if (dir.hasVending) {
      amenities.push(`
        <div class="amenity-icon-box vending" title="自動販売機">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="5" y="3" width="14" height="18" rx="2"></rect>
            <rect x="8" y="6" width="8" height="6"></rect>
            <line x1="8" y1="16" x2="16" y2="16"></line>
          </svg>
        </div>
      `);
    }

    const amenityHtml = amenities.length > 0 ? `<div class="amenity-row">${amenities.join("")}</div>` : "";

    const shopIconSvg = (catType) => {
      switch (catType) {
        case "takeout":
          return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 8h12l-1 12H7L6 8z"></path><path d="M9 8V6a3 3 0 0 1 6 0v2"></path></svg>`;
        case "foodcourt":
          return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 4v16M5 4v5a2 2 0 0 0 4 0V4M16 4v16M16 4c2 0 3 2 3 5h-3"></path></svg>`;
        case "shopping":
          return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 7h14l-1 13H6L5 7z"></path><path d="M9 7V5a3 3 0 0 1 6 0v2"></path></svg>`;
        case "cafe":
          return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 8h12v6a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V8z"></path><path d="M16 9h2a2 2 0 0 1 0 4h-2"></path></svg>`;
        default:
          return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="5" width="16" height="14" rx="2"></rect><line x1="4" y1="10" x2="20" y2="10"></line></svg>`;
      }
    };

    const categoriesHtml = dir.categories.map(cat => {
      const badgeCls = ["takeout", "foodcourt", "shopping", "cafe", "restaurant", "convenience"].includes(cat.catType)
        ? cat.catType
        : "default";
      const titleHtml = escapeHtml(cat.title).replace(/(\(24時間\)|（24時間）)/g, `<span class="badge-24h">$1</span>`);
      const subHtml = cat.items && cat.items.length > 0
        ? `<ul class="shop-sub-list">${cat.items.map(it => {
            const subHighlighted = escapeHtml(it).replace(/(\(24時間\)|（24時間）)/g, `<span class="badge-24h">$1</span>`);
            return `<li>${subHighlighted}</li>`;
          }).join("")}</ul>`
        : "";

      return `
        <div class="shop-category-item">
          <div class="shop-category-header">
            <span class="shop-cat-badge ${badgeCls}">${shopIconSvg(badgeCls)}</span>
            <span>${titleHtml}</span>
          </div>
          ${subHtml}
        </div>
      `;
    }).join("");

    const othersHtml = dir.others && dir.others.length > 0 ? `
      <div class="other-facilities-box">
        <div class="other-facilities-title">その他</div>
        <ul class="shop-sub-list">
          ${dir.others.map(o => `<li>${escapeHtml(o)}</li>`).join("")}
        </ul>
      </div>
    ` : "";

    return `
      <section class="direction-block">
        <h3 class="direction-title">${escapeHtml(dir.title)}</h3>
        ${parkingHtml}
        ${amenityHtml}
        <div class="shop-category-list">${categoriesHtml}</div>
        ${othersHtml}
      </section>
    `;
  }

  /**
   * IC / JCT / BS 詳細画面の描画（JCT接続高速道路リンク・併設施設切替対応）
   */
  function renderIcJctDetail(icDetail, meta, adjacent, fallbackConnectLinks = []) {
    const heroHtml = `
      <div class="ic-detail-hero">
        <div class="ic-hero-left">
          ${meta.num && meta.num !== "-" ? `<span class="ic-hero-num">${escapeHtml(meta.num)}</span>` : ""}
          ${renderFacilityBadges(meta.types)}
          <h2 class="ic-hero-name">${escapeHtml(meta.shortName || meta.name)}</h2>
        </div>
        ${meta.km ? `<div class="ic-hero-km">起点から ${escapeHtml(meta.km)}</div>` : ""}
      </div>
    `;

    const adjHtml = (adjacent && (adjacent.prev || adjacent.next)) ? `
      <div class="adjacent-nav-bar">
        <button type="button" class="adj-btn" id="prevFacilityBtn" ${adjacent.prev ? "" : "disabled"}>
          <span>← 前の施設</span>
          <span>${adjacent.prev ? escapeHtml(adjacent.prev.shortName) : "起点"}</span>
        </button>
        <button type="button" class="adj-btn" id="nextFacilityBtn" ${adjacent.next ? "" : "disabled"}>
          <span>${adjacent.next ? escapeHtml(adjacent.next.shortName) : "終点"}</span>
          <span>次の施設 →</span>
        </button>
      </div>
    ` : "";

    const renderRoadSign = (road) => {
      if (road.kind === "national") {
        return `
          <span class="road-sign-onigiri" title="一般国道">
            <svg viewBox="0 0 36 34"><path d="M18 2 C25 2 34 14 33 23 C32 30 25 32 18 32 C11 32 4 30 3 23 C2 14 11 2 18 2 Z" fill="#005bac" stroke="#ffffff" stroke-width="1.5"/></svg>
            <span>${escapeHtml(road.num)}</span>
          </span>
        `;
      }
      if (road.kind === "pref") {
        return `
          <span class="road-sign-hexa" title="都道府県道">
            <svg viewBox="0 0 36 34"><polygon points="18,2 33,10 33,24 18,32 3,24 3,10" fill="#005bac" stroke="#ffffff" stroke-width="1.5"/></svg>
            <span>${escapeHtml(road.num)}</span>
          </span>
        `;
      }
      if (road.kind === "highway") {
        return `<span class="route-num-badge">${escapeHtml(road.num || "HW")}</span>`;
      }
      return `<span class="f-badge other">接続</span>`;
    };

    // 記事内「接続する道路」リスト（高速道路の場合はクリック遷移カードにする）
    let roadsList = Array.isArray(icDetail.connectedRoads) ? [...icDetail.connectedRoads] : [];

    // 記事内に「接続する道路」が無い、または高速道路が含まれていない場合、路線表の接続高速道路を補完
    if (Array.isArray(fallbackConnectLinks) && fallbackConnectLinks.length > 0) {
      for (const fb of fallbackConnectLinks) {
        const alreadyExists = roadsList.some(r => r.kind === "highway" && (r.wikiTitle === fb.wikiTitle || r.name.includes(fb.name)));
        if (!alreadyExists) {
          roadsList.unshift({
            kind: "highway",
            num: fb.num || "HW",
            name: fb.num ? `${fb.num} ${fb.name}` : fb.name,
            hwName: fb.name,
            wikiTitle: fb.wikiTitle
          });
        }
      }
    }

    const roadsHtml = roadsList.length > 0 ? `
      <div class="wiki-prose-block">
        <h3>接続する道路</h3>
        <div class="connected-roads-list">
          ${roadsList.map(r => {
            if (r.kind === "highway") {
              const targetWiki = r.wikiTitle || r.hwName || r.name;
              const targetName = r.hwName || r.name;
              const targetNum = r.num || "HW";
              return `
                <div class="connected-road-card clickable-hw-card"
                     role="button"
                     tabindex="0"
                     data-hw-num="${escapeHtml(targetNum)}"
                     data-hw-name="${escapeHtml(targetName)}"
                     data-hw-wiki="${escapeHtml(targetWiki)}"
                     title="${escapeHtml(targetName)} の路線ページへ移動">
                  <div class="connected-road-card-left">
                    ${renderRoadSign(r)}
                    <span>${escapeHtml(r.name)}</span>
                  </div>
                  <span class="hw-jump-arrow">路線ページへ ↗</span>
                </div>
              `;
            }
            return `
              <div class="connected-road-card">
                ${renderRoadSign(r)}
                <span>${escapeHtml(r.name)}</span>
              </div>
            `;
          }).join("")}
        </div>
      </div>
    ` : "";

    const historyHtml = icDetail.historyItems && icDetail.historyItems.length > 0 ? `
      <div class="wiki-prose-block">
        <h3>歴史・沿革</h3>
        <ul class="shop-sub-list" style="padding-left: 12px;">
          ${icDetail.historyItems.map(h => `<li style="margin-bottom: 6px;">${escapeHtml(h)}</li>`).join("")}
        </ul>
      </div>
    ` : "";

    return heroHtml + adjHtml + roadsHtml + historyHtml;
  }

  /**
   * 概要ブロック（要約段落 ＋ 基礎情報テーブル）の描画
   */
  function renderOverviewTab(overview, title) {
    const paragraphsHtml = overview.paragraphs && overview.paragraphs.length > 0
      ? overview.paragraphs.map(p => `<p>${escapeHtml(p)}</p>`).join("")
      : `<p>Wikipediaから概要テキストを取得できませんでした。「原文」またはWikipedia本家リンクをご確認ください。</p>`;

    const infoboxHtml = overview.infobox && overview.infobox.length > 0 ? `
      <aside class="infobox-card">
        <div class="infobox-card-header">${escapeHtml(title)} 基本データ</div>
        <table class="infobox-table">
          <tbody>
            ${overview.infobox.slice(0, 14).map(row => `
              <tr>
                <th>${escapeHtml(row.key)}</th>
                <td>${escapeHtml(row.val)}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </aside>
    ` : "";

    return `
      <div class="overview-grid">
        <div class="wiki-prose-block" style="margin-top: 0;">
          ${paragraphsHtml}
        </div>
        ${infoboxHtml}
      </div>
    `;
  }

  /**
   * トップ画面：日本列島・高速道路ネットワーク簡易SVGマップ描画
   */
  function renderJapanMap(container, routes, activeRegion, onSelectRegion, onSelectRoute) {
    const regions = [
      { id: "hokkaido", label: "北海道", points: "325,25 385,25 395,75 350,95 320,122 308,108 325,70" },
      { id: "tohoku", label: "東北", points: "312,135 348,135 352,225 315,245 302,215" },
      { id: "kanto", label: "関東", points: "298,245 342,245 340,302 296,302" },
      { id: "chubu", label: "中部", points: "225,235 300,235 296,315 220,320 212,275" },
      { id: "kinki", label: "近畿", points: "172,285 222,285 218,342 170,338" },
      { id: "chugoku", label: "中国", points: "88,302 170,298 170,335 84,342" },
      { id: "shikoku", label: "四国", points: "115,346 168,344 164,376 112,376" },
      { id: "kyushu", label: "九州・沖縄", points: "48,346 95,346 92,415 52,415 22,432 54,432 54,405 48,380" }
    ];

    const regionPolygons = regions.map(r => {
      const isAct = activeRegion === r.id ? "active" : "";
      return `<polygon class="map-region-shape ${isAct}" data-region="${r.id}" data-label="${r.label}" points="${r.points}"></polygon>`;
    }).join("");

    const routePolylines = routes.map(rt => {
      if (!rt.mapCoords || rt.mapCoords.length < 2) return "";
      const pts = rt.mapCoords.map(c => c.join(",")).join(" ");
      return `<polyline class="map-route-line" data-route-id="${escapeHtml(rt.id)}" data-route-label="${escapeHtml(rt.number + " " + rt.name)}" stroke="${escapeHtml(rt.color || "#1b7837")}" points="${pts}"></polyline>`;
    }).join("");

    container.innerHTML = `
      <svg class="japan-map-svg" viewBox="0 0 415 450" role="img" aria-label="日本列島 高速道路簡易マップ">
        ${regionPolygons}
        ${routePolylines}
      </svg>
      <div class="map-tooltip" id="mapTooltip">
        <span>地方をクリックで絞り込み / 緑線クリックで路線へ</span>
      </div>
    `;

    const tooltip = container.querySelector("#mapTooltip");

    container.querySelectorAll(".map-region-shape").forEach(poly => {
      poly.addEventListener("mouseenter", () => {
        tooltip.innerHTML = `<span>エリア：${poly.dataset.label}地方（クリックで絞り込み）</span>`;
      });
      poly.addEventListener("click", () => {
        onSelectRegion(poly.dataset.region);
      });
    });

    container.querySelectorAll(".map-route-line").forEach(line => {
      line.addEventListener("mouseenter", () => {
        line.classList.add("highlighted");
        tooltip.innerHTML = `<span>路線：${line.dataset.routeLabel}（クリックで開く）</span>`;
      });
      line.addEventListener("mouseleave", () => {
        line.classList.remove("highlighted");
      });
      line.addEventListener("click", (e) => {
        e.stopPropagation();
        onSelectRoute(line.dataset.routeId);
      });
    });
  }

  return {
    escapeHtml,
    renderFacilityBadges,
    renderLanesVisual,
    renderSpeedSigns,
    renderSapaDirection,
    renderIcJctDetail,
    renderOverviewTab,
    renderJapanMap
  };
})();
