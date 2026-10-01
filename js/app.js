/**
 * app.js - 主应用流程
 * 串联: 地图初始化 → 地址输入 → 等时圈 → POI检索 → 灰色区域 → 评分 → 报告
 */

// 全局状态
const App = {
  map: null,
  currentCenter: null,
  isochroneData: null,
  poiData: null,
  gaps: null,
  score: null,
  overlays: [],      // 地图覆盖物集合
  markers: [],

  // ============ 初始化 ============
  init() {
    const BMapGL = window.BMapGL;
    if (!BMapGL) {
      this._showError('百度地图JS API未加载，请检查AK配置');
      return;
    }

    // 检查AK
    if (!window.BMAP_AK || window.BMAP_AK === '__BMAP_AK__') {
      this._showError('百度地图AK未配置。请编辑 js/config.js，将 __BMAP_AK__ 替换为你的AK，或在config.local.js中设置 window.BMAP_AK_OVERRIDE');
    }

    // 初始化地图（默认廉江罗州街道）
    const defaultCoord = SAMPLE_COMMUNITIES[0].coord;
    this.map = new BMapGL.Map('map-container');
    this.map.centerAndZoom(new BMapGL.Point(defaultCoord[0], defaultCoord[1]), 14);
    this.map.enableScrollWheelZoom(true);
    // 保存地图实例到全局，供LocalSearch等API使用
    window._bmapInstance = this.map;

    // 添加比例尺和缩放控件
    this.map.addControl(new BMapGL.ScaleControl());
    this.map.addControl(new BMapGL.ZoomControl());

    // 地图点击选点
    this.map.addEventListener('click', (e) => {
      const lng = e.latlng.lng, lat = e.latlng.lat;
      document.getElementById('coord-display').value = `${lng.toFixed(6)}, ${lat.toFixed(6)}`;
    });

    // 绑定事件
    this._bindEvents();

    console.log('15分钟生活圈助手初始化完成');
  },

  // ============ 事件绑定 ============
  _bindEvents() {
    // 开始体检按钮
    document.getElementById('btn-analyze').addEventListener('click', () => this.runAnalysis());

    // 回车触发
    document.getElementById('address-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.runAnalysis();
    });

    // 清除结果按钮
    document.getElementById('btn-clear').addEventListener('click', () => this.clearAll());

    // 样例社区快速选择
    const sampleSelect = document.getElementById('sample-select');
    SAMPLE_COMMUNITIES.forEach((s, i) => {
      const opt = document.createElement('option');
      opt.value = i; opt.textContent = s.name;
      sampleSelect.appendChild(opt);
    });
    sampleSelect.addEventListener('change', (e) => {
      const idx = parseInt(e.target.value);
      if (!isNaN(idx) && SAMPLE_COMMUNITIES[idx]) {
        document.getElementById('address-input').value = SAMPLE_COMMUNITIES[idx].name;
      }
    });
  },

  // ============ 主分析流程 ============
  async runAnalysis() {
    const address = document.getElementById('address-input').value.trim();
    const coordStr = document.getElementById('coord-display').value.trim();

    try {
      // Step 1: 解析中心点
      this._showProgress(5, '正在解析地址...');
      let center;
      if (coordStr && coordStr.includes(',')) {
        const [lng, lat] = coordStr.split(',').map(s => parseFloat(s.trim()));
        center = { lng, lat };
      } else if (address) {
        center = await this._geocode(address);
      } else {
        this._showError('请输入地址或点击地图选择坐标');
        return;
      }
      if (!center || isNaN(center.lng) || isNaN(center.lat)) {
        this._showError('地址解析失败，请输入完整地址（如：湛江市廉江市罗州街道）');
        return;
      }
      this.currentCenter = center;

      // Step 2: 构建等时圈
      this._showProgress(10, '正在构建15分钟步行等时圈...');
      this.isochroneData = await Isochrone.build(center, (cur, total, msg) => {
        this._showProgress(10 + (cur / Math.max(total, 1)) * 40, msg);
      });

      // 渲染等时圈
      this._renderIsochrone();
      this._showProgress(50, '等时圈构建完成');

      // Step 3: POI检索
      this.poiData = await POI.searchAll(this.isochroneData.polygon, center, (cur, total, msg) => {
        this._showProgress(50 + (cur / Math.max(total, 1)) * 25, msg);
      });
      this._renderPOIs();
      this._showProgress(75, '设施检索完成');

      // Step 4: 灰色区域识别
      this._showProgress(78, '正在识别服务盲区...');
      this.gaps = await POI.identifyGaps(this.isochroneData.polygon, center, this.poiData.byCategory, (cur, total, msg) => {
        this._showProgress(78 + (cur / Math.max(total, 1)) * 10, msg);
      });
      this._renderGaps();
      this._showProgress(88, '盲区识别完成');

      // Step 5: 评分
      this._showProgress(90, '正在计算评分...');
      this.score = Dashboard.calcScore(this.poiData.byCategory, this.isochroneData);
      this._renderDashboard();
      this._showProgress(95, '评分计算完成');

      // Step 6: 生成报告
      this._renderReport();
      this._showProgress(97, '正在生成规划建议...');

      // Step 7: 规划模拟建议（差异化亮点）
      const suggestions = Planning.suggestLocations(this.gaps, this.isochroneData, this.poiData.byCategory);
      Planning._suggestions = suggestions;
      Planning.renderPanel(suggestions);
      this._showProgress(100, '体检完成！');

      // 隐藏进度条（延迟）
      setTimeout(() => this._hideProgress(), 1500);

    } catch (e) {
      console.error('分析失败:', e);
      this._showError(`分析失败: ${e.message}`);
      this._hideProgress();
    }
  },

  // ============ 地理编码 ============
  _geocode(address) {
    return new Promise((resolve) => {
      const BMapGL = window.BMapGL;
      let resolved = false;
      const safeResolve = (val) => { if (!resolved) { resolved = true; resolve(val); } };
      const geo = new BMapGL.Geocoder();
      geo.getPoint(address, (point) => {
        if (resolved) return;
        if (point) safeResolve({ lng: point.lng, lat: point.lat });
        else safeResolve(null);
      }, '全国');
      setTimeout(() => safeResolve(null), 10000);
    });
  },

  // ============ 渲染: 等时圈 ============
  _renderIsochrone() {
    const BMapGL = window.BMapGL;
    const { polygon, layers, area, center } = this.isochroneData;
    this._clearOverlays();

    // 中心点标记
    const centerMarker = new BMapGL.Marker(new BMapGL.Point(center.lng, center.lat));
    this.map.addOverlay(centerMarker);
    this.overlays.push(centerMarker);

    // 15分钟层
    if (polygon.length >= 3) {
      const poly15 = new BMapGL.Polygon(
        polygon.map(p => new BMapGL.Point(p.lng, p.lat)),
        { strokeColor: THEME.layer15Stroke, fillColor: THEME.layer15, strokeWeight: 2, fillOpacity: 1 }
      );
      this.map.addOverlay(poly15);
      this.overlays.push(poly15);
    }

    // 10分钟层
    if (layers[10] && layers[10].length >= 3) {
      const poly10 = new BMapGL.Polygon(
        layers[10].map(p => new BMapGL.Point(p.lng, p.lat)),
        { strokeColor: THEME.layer10Stroke, fillColor: THEME.layer10, strokeWeight: 2, fillOpacity: 1 }
      );
      this.map.addOverlay(poly10);
      this.overlays.push(poly10);
    }

    // 5分钟层
    if (layers[5] && layers[5].length >= 3) {
      const poly5 = new BMapGL.Polygon(
        layers[5].map(p => new BMapGL.Point(p.lng, p.lat)),
        { strokeColor: THEME.layer5Stroke, fillColor: THEME.layer5, strokeWeight: 2, fillOpacity: 1 }
      );
      this.map.addOverlay(poly5);
      this.overlays.push(poly5);
    }

    // 视图适配
    if (polygon.length >= 3) {
      this.map.setViewport(polygon.map(p => new BMapGL.Point(p.lng, p.lat)));
    }

    // 更新信息卡
    document.getElementById('iso-area').textContent = area.toFixed(2) + ' km²';
    document.getElementById('iso-points').textContent = this.isochroneData.boundaryPoints.length;
  },

  // ============ 渲染: POI ============
  _renderPOIs() {
    const BMapGL = window.BMapGL;
    const categoryColors = {
      hospital: '#ef4444', pharmacy: '#f59e0b', market: '#22c55e',
      supermarket: '#84cc16', school: '#3b82f6', transit: '#8b5cf6',
      elderly: '#ec4899', culture: '#06b6d4', green: '#10b981',
    };

    this.poiData.all.forEach(poi => {
      const marker = new BMapGL.Marker(new BMapGL.Point(poi.lng, poi.lat));
      const label = new BMapGL.Label(poi.title, {
        offset: new BMapGL.Size(8, -16),
      });
      label.setStyle({
        color: '#e2e8f0', fontSize: '10px', backgroundColor: 'rgba(15,23,42,0.8)',
        border: '1px solid #334155', borderRadius: '3px', padding: '1px 4px',
      });
      marker.setLabel(label);
      this.map.addOverlay(marker);
      this.markers.push(marker);
    });

    // 更新统计
    let totalCount = 0;
    const catStats = {};
    POI_CATEGORIES.forEach(cat => {
      const count = (this.poiData.byCategory[cat.key] || []).length;
      catStats[cat.key] = { count, name: cat.name };
      totalCount += count;
    });
    document.getElementById('poi-total').textContent = totalCount;
    this._catStats = catStats;
  },

  // ============ 渲染: 灰色区域 ============
  _renderGaps() {
    const BMapGL = window.BMapGL;
    if (!this.gaps || this.gaps.length === 0) {
      document.getElementById('gap-count').textContent = '0';
      return;
    }

    this.gaps.forEach(cluster => {
      if (cluster.length < 2) return;
      // 用热力点或矩形表示盲区
      const poly = new BMapGL.Polygon(
        cluster.map(p => new BMapGL.Point(p.lng, p.lat)),
        { strokeColor: THEME.gapStroke, fillColor: THEME.gapColor, strokeWeight: 1, fillOpacity: 0.8 }
      );
      this.map.addOverlay(poly);
      this.overlays.push(poly);
    });

    document.getElementById('gap-count').textContent = this.gaps.length;
  },

  // ============ 渲染: 评分仪表盘 ============
  _renderDashboard() {
    Dashboard.renderScoreRing('score-ring-container', this.score.total, this.score.grade);
    Dashboard.renderRadar('radar-chart', this.score.breakdown);
    Dashboard.renderBarChart('bar-chart', this.poiData.byCategory);
    const scoreEl = document.getElementById('score-value');
    if (scoreEl) scoreEl.textContent = this.score.total;
  },

  // ============ 渲染: 体检报告 ============
  _renderReport() {
    const reportEl = document.getElementById('report-content');
    const { total, grade, breakdown } = this.score;
    const { area } = this.isochroneData;
    const gaps = this.gaps || [];

    // 优势类别
    const goodCats = POI_CATEGORIES.filter(cat => (this.poiData.byCategory[cat.key] || []).length >= cat.ideal);
    const badCats = POI_CATEGORIES.filter(cat => (this.poiData.byCategory[cat.key] || []).length < cat.min);
    const midCats = POI_CATEGORIES.filter(cat => {
      const n = (this.poiData.byCategory[cat.key] || []).length;
      return n >= cat.min && n < cat.ideal;
    });

    let html = `
      <div class="report-section">
        <h3>概览</h3>
        <p>该社区15分钟步行圈面积 <strong>${area.toFixed(2)} km²</strong>，圈内共检索到
        <strong>${this.poiData.all.length}</strong> 处民生设施，综合评分
        <strong style="color:${total >= 70 ? '#22c55e' : total >= 50 ? '#f59e0b' : '#ef4444'}">${total}分（${grade}）</strong>。</p>
      </div>
      <div class="report-section">
        <h3>优势</h3>
        ${goodCats.length > 0 ?
          `<p>以下设施覆盖充分：</p><ul>${goodCats.map(c =>
            `<li>${c.name}（${(this.poiData.byCategory[c.key] || []).length}处，达理想标准${c.ideal}）</li>`).join('')}</ul>` :
          '<p>暂无明显优势设施。</p>'}
      </div>
      <div class="report-section">
        <h3>不足</h3>
        ${badCats.length > 0 ?
          `<p>以下设施匮乏：</p><ul>${badCats.map(c =>
            `<li><strong>${c.name}</strong>（0处，低于最低标准${c.min}）</li>`).join('')}</ul>` :
          '<p>各类设施均达最低标准。</p>'}
        ${midCats.length > 0 ?
          `<p>以下设施有但不足：</p><ul>${midCats.map(c =>
            `<li>${c.name}（${(this.poiData.byCategory[c.key] || []).length}处，理想${c.ideal}）</li>`).join('')}</ul>` : ''}
      </div>
      <div class="report-section">
        <h3>服务盲区</h3>
        ${gaps.length > 0 ?
          `<p>识别到 <strong style="color:#ef4444">${gaps.length}</strong> 处连片服务盲区
          （菜市场/药店/学校三类设施步行距离均超过1公里的区域）：</p>
          <ul>${gaps.map((g, i) => `<li>盲区${i+1}：约${(g.length * GAP_CONFIG.GRID_SIZE * GAP_CONFIG.GRID_SIZE / 1000000).toFixed(2)} km²</li>`).join('')}</ul>` :
          '<p style="color:#22c55e">未发现连片服务盲区，设施分布较均衡。</p>'}
      </div>
      <div class="report-section">
        <h3>改造建议</h3>
        <ul>
          ${badCats.map(c => `<li>建议在等时圈内增设<strong>${c.name}</strong>设施（可优先在盲区附近选址）</li>`).join('')}
          ${gaps.length > 0 ? `<li>盲区区域应优先安排设施落地，可提升整体覆盖率</li>` : ''}
          ${midCats.length > 0 ? `<li>${midCats.map(c => c.name).join('、')} 可适度增加布点密度</li>` : ''}
        </ul>
      </div>
    `;
    reportEl.innerHTML = html;
  },

  // ============ 工具方法 ============
  _clearOverlays() {
    this.overlays.forEach(o => this.map.removeOverlay(o));
    this.overlays = [];
    this.markers.forEach(m => this.map.removeOverlay(m));
    this.markers = [];
  },

  clearAll() {
    this._clearOverlays();
    this.currentCenter = null;
    this.isochroneData = null;
    this.poiData = null;
    this.gaps = null;
    this.score = null;
    document.getElementById('report-content').innerHTML = '<p class="text-muted">输入地址开始体检</p>';
    document.getElementById('iso-area').textContent = '-';
    document.getElementById('poi-total').textContent = '-';
    document.getElementById('gap-count').textContent = '-';
  },

  _showProgress(pct, msg) {
    const bar = document.getElementById('progress-bar');
    const text = document.getElementById('progress-text');
    bar.style.width = pct + '%';
    text.textContent = msg || '';
    bar.parentElement.style.display = 'block';
  },

  _hideProgress() {
    document.getElementById('progress-bar').parentElement.style.display = 'none';
  },

  _showError(msg) {
    const errEl = document.getElementById('error-message');
    errEl.textContent = msg;
    errEl.style.display = 'block';
    setTimeout(() => { errEl.style.display = 'none'; }, 5000);
  },
};

// ============ 启动 ============
window.addEventListener('load', () => {
  App.init();
});
