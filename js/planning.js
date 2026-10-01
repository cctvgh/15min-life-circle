/**
 * planning.js - 规划模拟功能（差异化亮点，竞品未实现）
 * "假设在XX位置新增一所小学，覆盖率提升多少？"
 */

const Planning = {

  /**
   * 模拟新增设施后的覆盖变化
   * @param {Object} isochroneData - 等时圈数据
   * @param {Object} poiByCategory - 当前POI
   * @param {String} categoryKey - 要新增的设施类别
   * @param {Object} newLocation - 新设施位置 {lng, lat}
   * @returns {Object} { before, after, improvement }
   */
  simulate(isochroneData, poiByCategory, categoryKey, newLocation) {
    const center = isochroneData.center;

    // 原始评分
    const before = Dashboard.calcScore(poiByCategory, isochroneData);

    // 模拟新增设施
    const simulatedPOI = {};
    Object.keys(poiByCategory).forEach(key => {
      simulatedPOI[key] = [...(poiByCategory[key] || [])];
    });
    simulatedPOI[categoryKey] = simulatedPOI[categoryKey] || [];
    simulatedPOI[categoryKey].push({
      title: '【模拟新增】设施',
      lng: newLocation.lng,
      lat: newLocation.lat,
      category: categoryKey,
      simulated: true,
    });

    // 新评分
    const after = Dashboard.calcScore(simulatedPOI, isochroneData);

    // 计算改善
    const improvement = {
      total: after.total - before.total,
      breakdown: {},
    };
    Object.keys(before.breakdown).forEach(key => {
      improvement.breakdown[key] = after.breakdown[key] - before.breakdown[key];
    });

    return { before, after, improvement, category: categoryKey, location: newLocation };
  },

  /**
   * 生成选址建议（在盲区中心推荐新增设施位置）
   * @param {Array} gaps - 盲区列表
   * @param {Object} isochroneData
   * @param {Object} poiByCategory
   * @returns {Array} 建议列表
   */
  suggestLocations(gaps, isochroneData, poiByCategory) {
    const suggestions = [];
    if (!gaps || gaps.length === 0) return suggestions;

    // 找出最匮乏的设施类别
    const lacking = POI_CATEGORIES
      .map(cat => ({ cat, count: (poiByCategory[cat.key] || []).length }))
      .filter(x => x.count < x.cat.min)
      .sort((a, b) => a.count - b.count);

    gaps.forEach((cluster, idx) => {
      if (cluster.length < 2) return;

      if (lacking.length > 0) {
        const target = lacking[0].cat;
        // AI 规划决策引擎：在盲区候选域内启发式寻优，选取评分增益最大的落点（而非简单取中心）
        const opt = AIDecision.optimizePlacement(cluster, target, isochroneData, poiByCategory);
        suggestions.push({
          gapIndex: idx,
          location: opt.location,
          category: target,
          scoreImprovement: opt.improvement.total,
          beforeTotal: opt.before.total,
          afterTotal: opt.after.total,
          reason: opt.reason,
          message: opt.reason,
        });
      }
    });

    return suggestions;
  },

  /**
   * 渲染规划模拟UI
   */
  renderPanel(suggestions) {
    const panel = document.getElementById('planning-content');
    if (!suggestions || suggestions.length === 0) {
      panel.innerHTML = '<p class="text-muted">暂无优化建议（未发现服务盲区或设施已达标）</p>';
      return;
    }

    let html = '<ul class="planning-list">';
    suggestions.forEach(s => {
      html += `
        <li class="planning-item">
          <div class="planning-msg">${s.message}</div>
          <button class="btn btn-sm" onclick="Planning.applySuggestion(${s.gapIndex})">在地图标出</button>
        </li>`;
    });
    html += '</ul>';
    panel.innerHTML = html;
  },

  /**
   * 在地图上标出建议位置
   */
  applySuggestion(gapIndex) {
    const BMapGL = window.BMapGL;
    const suggestion = (this._suggestions || [])[gapIndex];
    if (!suggestion || !BMapGL) return;

    const marker = new BMapGL.Marker(new BMapGL.Point(suggestion.location.lng, suggestion.location.lat));
    const label = new BMapGL.Label(`建议新增：${suggestion.category.name}`, {
      offset: new BMapGL.Size(10, -20),
    });
    label.setStyle({
      color: '#fde047', fontSize: '11px', fontWeight: '600',
      backgroundColor: 'rgba(15,23,42,0.9)',
      border: '1px solid #f59e0b', borderRadius: '4px', padding: '2px 6px',
    });
    marker.setLabel(label);
    App.map.addOverlay(marker);
    App.overlays.push(marker);
  },

  _suggestions: [],
};
