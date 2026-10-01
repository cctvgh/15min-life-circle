/**
 * poi.js - POI检索 + 9类民生设施统计 + 灰色区域识别
 * 借鉴: life-circle-demo的LocalSearch兼容 + λ标定 + 斑块聚合
 */

const POI = {

  /**
   * 检索等时圈内所有POI
   * @param {Array} polygon - 等时圈多边形 [{lng,lat}]
   * @param {Object} center - 中心点
   * @param {Function} onProgress
   * @returns {Promise<Object>} { byCategory: {key: [poi]}, all: [poi] }
   */
  async searchAll(polygon, center, onProgress) {
    onProgress = onProgress || (() => {});
    const BMapGL = window.BMapGL;
    if (!BMapGL) throw new Error('百度地图JS API未加载');

    // 构建百度多边形用于检索
    const bpolygon = polygon.map(p => new BMapGL.Point(p.lng, p.lat));
    const byCategory = {};
    const allPOIs = [];
    let totalKeywords = 0;

    POI_CATEGORIES.forEach(cat => { totalKeywords += cat.keywords.length; byCategory[cat.key] = []; });

    // 收集所有检索任务（类别+关键词）
    const tasks = [];
    POI_CATEGORIES.forEach(cat => {
      cat.keywords.forEach(kw => tasks.push({ cat, kw }));
    });

    // 小批量并发（每批2个）+ 批间250ms间隔，兼顾速度与QPS安全
    const BATCH = 2;
    let completed = 0;
    let searchErrors = 0;

    const processOne = async (task) => {
      const { cat, kw } = task;
      try {
        const pois = await this._searchInPolygon(kw, bpolygon, center);
        // 去重（同类别内按坐标去重）
        pois.forEach(poi => {
          const exists = byCategory[cat.key].some(p =>
            Math.abs(p.lng - poi.lng) < 0.001 && Math.abs(p.lat - poi.lat) < 0.001
          );
          if (!exists) {
            byCategory[cat.key].push({ ...poi, category: cat.key, categoryName: cat.name });
            allPOIs.push({ ...poi, category: cat.key, categoryName: cat.name });
          }
        });
      } catch (e) {
        searchErrors++;
        console.warn(`POI检索失败 ${cat.name}/${kw}:`, e.message);
      } finally {
        completed++;
        onProgress(completed, totalKeywords, `设施检索 ${completed}/${totalKeywords}`);
      }
    };

    for (let i = 0; i < tasks.length; i += BATCH) {
      const batch = tasks.slice(i, i + BATCH);
      await Promise.all(batch.map(t => processOne(t)));
      if (i + BATCH < tasks.length) {
        await new Promise(r => setTimeout(r, 250));
      }
    }

    console.log(`[POI] 检索完成: ${allPOIs.length}个设施, ${searchErrors}次失败`);
    return { byCategory, all: allPOIs };
  },

  // 多边形内POI检索（用外接矩形Bounds + 多边形内点筛选）
  _searchInPolygon(keyword, bpolygon, center) {
    return new Promise((resolve) => {
      const BMapGL = window.BMapGL;
      let resolved = false;  // 防止超时与回调双重resolve
      const safeResolve = (val) => { if (!resolved) { resolved = true; resolve(val); } };

      try {
        // searchInBounds需要Bounds对象（外接矩形），非Polygon
        let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
        bpolygon.forEach(p => {
          minLng = Math.min(minLng, p.lng); maxLng = Math.max(maxLng, p.lng);
          minLat = Math.min(minLat, p.lat); maxLat = Math.max(maxLat, p.lat);
        });
        const bounds = new BMapGL.Bounds(
          new BMapGL.Point(minLng, minLat),
          new BMapGL.Point(maxLng, maxLat)
        );

        // 百度LocalSearch构造函数第一个参数应为map实例，非坐标点
        // 若传center(Point对象)则搜索结果无法正常回调
        const mapInstance = App.map || window._bmapInstance;
        const searchCenter = mapInstance || center;

        const local = new BMapGL.LocalSearch(searchCenter, {
          onSearchComplete: (results) => {
            if (resolved) return; // 超时已resolve，忽略迟到的回调
            const pois = BMapCompat.extractPOIs(results);
            // 筛选在多边形内的POI（外接矩形会包含圈外点，需精确过滤）
            const filtered = pois.filter(poi =>
              poi.lng !== 0 && poi.lat !== 0 &&
              this._pointInPolygon(poi, bpolygon)
            );
            console.log(`[POI] "${keyword}" 检索完成: 原始${pois.length}个, 圈内${filtered.length}个`);
            safeResolve(filtered);
          },
          pageCapacity: 50,
        });
        local.searchInBounds(keyword, bounds);

        // 超时保护：12秒后若回调未触发则返回空数组
        setTimeout(() => {
          if (!resolved) {
            console.warn(`[POI] "${keyword}" 检索超时(12s)，返回空结果`);
            safeResolve([]);
          }
        }, 12000);
      } catch (e) {
        console.error(`[POI] "${keyword}" 检索异常:`, e.message);
        safeResolve([]);
      }
    });
  },

  // 射线法判断点在多边形内
  _pointInPolygon(poi, bpolygon) {
    const x = poi.lng, y = poi.lat;
    let inside = false;
    const n = bpolygon.length;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = bpolygon[i].lng, yi = bpolygon[i].lat;
      const xj = bpolygon[j].lng, yj = bpolygon[j].lat;
      if (((yi > y) !== (yj > y)) &&
          (x < (xj - xi) * (y - yi) / (yj - yi + 0.0000001) + xi)) {
        inside = !inside;
      }
    }
    return inside;
  },

  // ============ 灰色区域识别（借鉴life-circle-demo gap.js） ============
  /**
   * @param {Array} polygon - 等时圈多边形
   * @param {Object} center - 中心点
   * @param {Object} poiByCategory - 各类POI
   * @param {Function} onProgress
   * @returns {Promise<Array>} 盲区栅格列表
   */
  async identifyGaps(polygon, center, poiByCategory, onProgress) {
    onProgress = onProgress || (() => {});
    const cfg = GAP_CONFIG;

    // 1. 多边形内栅格化
    const gridPoints = this._gridifyPolygon(polygon, cfg.GRID_SIZE);
    onProgress(0, gridPoints.length, '栅格化采样');

    // 2. λ标定（6次步行路线验证绕行系数）
    const lambda = await this._calibrateLambda(center, polygon);
    onProgress(gridPoints.length, gridPoints.length, '绕行系数标定完成');

    // 3. 计算每个栅格到最近设施的"路网距离"（直线距离×λ）
    const gaps = [];
    const criticalCats = ['market', 'pharmacy', 'school'];

    for (let i = 0; i < gridPoints.length; i++) {
      const gp = gridPoints[i];
      let allFar = true;

      for (const catKey of criticalCats) {
        const pois = poiByCategory[catKey] || [];
        if (pois.length === 0) continue;
        const minDist = Math.min(...pois.map(p => Isochrone._haversine(gp.lng, gp.lat, p.lng, p.lat)));
        const walkDist = minDist * lambda;
        if (walkDist <= cfg.GAP_THRESHOLD) {
          allFar = false;
          break;
        }
      }
      if (allFar) gaps.push(gp);
    }

    // 4. 连通斑块聚合（相邻盲区格合并）
    const clusters = this._clusterGaps(gaps, cfg.GRID_SIZE);
    onProgress(gridPoints.length, gridPoints.length, '盲区识别完成');

    return clusters;
  },

  // 多边形内栅格化
  _gridifyPolygon(polygon, gridSize) {
    if (polygon.length < 3) return [];
    let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
    polygon.forEach(p => {
      minLng = Math.min(minLng, p.lng);
      maxLng = Math.max(maxLng, p.lng);
      minLat = Math.min(minLat, p.lat);
      maxLat = Math.max(maxLat, p.lat);
    });
    const latStep = gridSize / 111111;
    const lngStep = gridSize / (111111 * Math.cos((minLat + maxLat) / 2 * Math.PI / 180));
    const points = [];
    for (let lat = minLat; lat <= maxLat; lat += latStep) {
      for (let lng = minLng; lng <= maxLng; lng += lngStep) {
        if (this._pointInPolygon({ lng, lat }, polygon.map(p => ({ lng: p.lng, lat: p.lat })))) {
          points.push({ lng, lat });
        }
      }
    }
    return points;
  },

  // λ标定：用少量步行路线估算绕行系数
  async _calibrateLambda(center, polygon) {
    const cfg = GAP_CONFIG;
    const BMapGL = window.BMapGL;
    const samples = [];

    // 取多边形边界上的6个点做采样
    const step = Math.floor(polygon.length / cfg.LAMBDA_SAMPLES);
    for (let i = 0; i < cfg.LAMBDA_SAMPLES && i * step < polygon.length; i++) {
      const bp = polygon[i * step];
      try {
        const directDist = Isochrone._haversine(center.lng, center.lat, bp.lng, bp.lat);
        const path = await this._walkingRoute(
          new BMapGL.Point(center.lng, center.lat),
          new BMapGL.Point(bp.lng, bp.lat)
        );
        if (path && path.length > 1) {
          let pathDist = 0;
          for (let j = 1; j < path.length; j++) {
            pathDist += Isochrone._haversine(path[j-1].lng, path[j-1].lat, path[j].lng, path[j].lat);
          }
          if (directDist > 0) samples.push(pathDist / directDist);
        }
      } catch (e) { /* skip */ }
    }

    if (samples.length === 0) return 1.3; // 默认绕行系数
    return samples.reduce((a, b) => a + b) / samples.length;
  },

  _walkingRoute(origin, dest) {
    return new Promise((resolve) => {
      const BMapGL = window.BMapGL;
      let resolved = false;
      const safeResolve = (val) => { if (!resolved) { resolved = true; resolve(val); } };
      try {
        const walking = new BMapGL.WalkingRoute(origin, {
          onSearchComplete: (results) => {
            if (resolved) return;
            safeResolve(BMapCompat.extractWalkingPath(results));
          },
        });
        walking.search(origin, dest);
        setTimeout(() => {
          if (!resolved) safeResolve(null);
        }, 10000);
      } catch (e) { safeResolve(null); }
    });
  },

  // 连通斑块聚合（简单网格邻接）
  _clusterGaps(gaps, gridSize) {
    if (gaps.length === 0) return [];
    const visited = new Set();
    const clusters = [];

    for (let i = 0; i < gaps.length; i++) {
      if (visited.has(i)) continue;
      const cluster = [gaps[i]];
      visited.add(i);
      // BFS找相邻格
      const queue = [i];
      while (queue.length > 0) {
        const idx = queue.shift();
        for (let j = 0; j < gaps.length; j++) {
          if (visited.has(j)) continue;
          const dist = Isochrone._haversine(gaps[idx].lng, gaps[idx].lat, gaps[j].lng, gaps[j].lat);
          if (dist < gridSize * 1.5) {
            visited.add(j);
            cluster.push(gaps[j]);
            queue.push(j);
          }
        }
      }
      if (cluster.length >= GAP_CONFIG.MIN_CLUSTER_SIZE) {
        clusters.push(cluster);
      }
    }
    return clusters;
  },
};
