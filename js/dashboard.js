/**
 * dashboard.js - 4维加权评分 + 可视化图表
 * 借鉴: life-circle-demo的4维评分 + 距离衰减曲线
 * 需要: ECharts（CDN加载 + 本地回退）
 */

const Dashboard = {

  /**
   * 计算4维加权评分
   * @param {Object} poiByCategory
   * @param {Object} isochroneData - { polygon, area, center }
   * @returns {Object} { total, breakdown }
   */
  calcScore(poiByCategory, isochroneData) {
    const center = isochroneData.center;
    const area = isochroneData.area;

    // ===== 维度1: 配套完整度（30%）=====
    let completenessSum = 0, totalWeight = 0;
    POI_CATEGORIES.forEach(cat => {
      const pois = poiByCategory[cat.key] || [];
      const actual = pois.length;
      let catScore;
      if (actual <= 0) catScore = 0;
      else if (actual <= cat.min) catScore = (actual / cat.min) * 40;
      else if (actual <= cat.ideal) catScore = 40 + (actual - cat.min) / (cat.ideal - cat.min) * 60;
      else catScore = Math.min(100, 100 + (actual - cat.ideal) * 5);
      completenessSum += catScore * cat.weight;
      totalWeight += cat.weight;
    });
    const completeness = totalWeight > 0 ? completenessSum / totalWeight : 0;

    // ===== 维度2: 就近便利度（35%）=====
    let proximitySum = 0, proximityCount = 0;
    POI_CATEGORIES.forEach(cat => {
      const pois = poiByCategory[cat.key] || [];
      if (pois.length === 0) {
        proximitySum += 0;
        proximityCount += cat.weight;
        return;
      }
      // 找最近POI，按距离衰减
      const minDist = Math.min(...pois.map(p => Isochrone._haversine(center.lng, center.lat, p.lng, p.lat)));
      const score = this._proximityScore(minDist);
      proximitySum += score * cat.weight;
      proximityCount += cat.weight;
    });
    const proximity = proximityCount > 0 ? proximitySum / proximityCount : 0;

    // ===== 维度3: 等时圈覆盖（20%）=====
    let coverage;
    if (area >= SCORE_CONFIG.coverageThreshold * 2) coverage = 100;
    else if (area >= SCORE_CONFIG.coverageThreshold) coverage = 60 + (area - 1) / 1 * 40;
    else if (area >= 0.5) coverage = (area / SCORE_CONFIG.coverageThreshold) * 60;
    else coverage = area / 0.5 * 30;

    // ===== 维度4: 类别多样性（15%）=====
    const presentCats = POI_CATEGORIES.filter(cat => (poiByCategory[cat.key] || []).length > 0).length;
    const diversity = (presentCats / POI_CATEGORIES.length) * 100;

    // ===== 加权总分 =====
    const dims = {
      completeness: Math.round(completeness),
      proximity: Math.round(proximity),
      coverage: Math.round(coverage),
      diversity: Math.round(diversity),
    };
    let total = 0;
    SCORE_CONFIG.dimensions.forEach(d => {
      total += dims[d.key] * d.weight;
    });
    total = Math.round(total);

    const grade = total >= 85 ? '优秀' : total >= 70 ? '良好' : total >= 50 ? '一般' : '较差';

    return { total, grade, breakdown: dims };
  },

  // 距离衰减曲线插值
  _proximityScore(dist) {
    const curve = SCORE_CONFIG.proximityCurve;
    if (dist <= curve[0].dist) return curve[0].score;
    if (dist >= curve[curve.length - 1].dist) return curve[curve.length - 1].score;
    for (let i = 1; i < curve.length; i++) {
      if (dist <= curve[i].dist) {
        const { dist: d0, score: s0 } = curve[i-1];
        const { dist: d1, score: s1 } = curve[i];
        const ratio = (dist - d0) / (d1 - d0);
        return s0 + (s1 - s0) * ratio;
      }
    }
    return 0;
  },

  // ============ 渲染雷达图 ============
  renderRadar(containerId, breakdown) {
    const echarts = window.echarts;
    if (!echarts) return;
    const el = document.getElementById(containerId);
    if (!el) return;
    const chart = echarts.init(el);
    chart.setOption({
      radar: {
        indicator: SCORE_CONFIG.dimensions.map(d => ({ name: d.name, max: 100 })),
        splitArea: { areaStyle: { color: ['rgba(26,95,180,0.1)', 'rgba(26,95,180,0.05)'] } },
        axisName: { color: '#94a3b8', fontSize: 11 },
      },
      series: [{
        type: 'radar',
        data: [{
          value: SCORE_CONFIG.dimensions.map(d => breakdown[d.key]),
          name: '实际评分',
          areaStyle: { color: 'rgba(74,144,217,0.3)' },
          lineStyle: { color: '#4a90d9', width: 2 },
          itemStyle: { color: '#4a90d9' },
        }],
      }],
    });
    return chart;
  },

  // ============ 渲染POI柱状图 ============
  renderBarChart(containerId, poiByCategory) {
    const echarts = window.echarts;
    if (!echarts) return;
    const el = document.getElementById(containerId);
    if (!el) return;
    const chart = echarts.init(el);
    const names = POI_CATEGORIES.map(c => c.name);
    const values = POI_CATEGORIES.map(c => (poiByCategory[c.key] || []).length);
    chart.setOption({
      tooltip: { trigger: 'axis' },
      grid: { left: 50, right: 20, top: 20, bottom: 30 },
      xAxis: {
        type: 'category',
        data: names,
        axisLabel: { color: '#94a3b8', fontSize: 10, rotate: 30 },
      },
      yAxis: { type: 'value', axisLabel: { color: '#94a3b8' } },
      series: [{
        type: 'bar',
        data: values,
        itemStyle: { color: '#4a90d9', borderRadius: [4, 4, 0, 0] },
        barWidth: 16,
      }],
    });
    return chart;
  },

  // ============ 渲染评分环 ============
  renderScoreRing(containerId, total, grade) {
    const el = document.getElementById(containerId);
    if (!el) return;
    const color = total >= 85 ? '#22c55e' : total >= 70 ? '#4a90d9' : total >= 50 ? '#f59e0b' : '#ef4444';
    el.innerHTML = `
      <div class="score-ring" style="--score-color:${color}">
        <svg viewBox="0 0 120 120" width="120" height="120">
          <circle cx="60" cy="60" r="50" fill="none" stroke="#334155" stroke-width="10"/>
          <circle cx="60" cy="60" r="50" fill="none" stroke="${color}" stroke-width="10"
                  stroke-dasharray="${total * 3.14}, 314"
                  stroke-linecap="round" transform="rotate(-90 60 60)"/>
          <text x="60" y="58" text-anchor="middle" fill="${color}" font-size="24" font-weight="700">${total}</text>
          <text x="60" y="80" text-anchor="middle" fill="#94a3b8" font-size="12">${grade}</text>
        </svg>
      </div>
    `;
  },
};
