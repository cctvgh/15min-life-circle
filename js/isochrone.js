/**
 * isochrone.js - 自适应射线-网格混合等时圈算法
 * 融合6个开源项目精华：OSRM网格采样 + Valhalla边插值 + GraphHopper方向锥预筛
 * + pgRouting Alpha Shape + life-circle-demo弧长插值 + travel-in-hours缓存
 *
 * 核心流程:
 * 1. 方向锥预筛（GraphHopper Cell剪枝思想）
 * 2. 16方向射线采样（life-circle-demo方案）
 * 3. 弧长插值（Valhalla边插值思想）
 * 4. 路口优先网格加密（GraphHopper pillar/tower分级思想）[P1待实现]
 * 5. Alpha Shape凹包边界（pgRouting算法 + Delaunator）[P1待实现]
 */

const Isochrone = {

  /**
   * 构建等时圈
   * @param {Object} center - 中心点 {lng, lat}
   * @param {Function} onProgress - 进度回调 (current, total, msg)
   * @returns {Promise<Object>} { polygon, boundaryPoints, layers, area }
   */
  async build(center, onProgress) {
    const cfg = ISOCHRONE_CONFIG;
    const BMapGL = window.BMapGL;
    if (!BMapGL) throw new Error('百度地图JS API未加载');

    onProgress = onProgress || (() => {});

    // ========== Step 1: 方向锥预筛 ==========
    const validDirections = this._filterDirections(center, cfg);
    onProgress(0, validDirections.length, '方向锥预筛完成');

    // ========== Step 2: 16方向射线采样 ==========
    const rayPoints = await this._raySampling(center, validDirections, onProgress);

    // ========== Step 3: 网格加密（GraphHopper pillar/tower思想） ==========
    onProgress(validDirections.length, validDirections.length, '射线采样完成，开始网格加密');
    const gridPoints = await this._gridDensify(center, rayPoints, onProgress);

    // ========== Step 4: 合并边界点 + Alpha Shape生成多边形 ==========
    const allPoints = [...rayPoints, ...gridPoints];
    const polygon = AlphaShape.compute(
      allPoints.map(p => ({ lng: p.lng, lat: p.lat }))
    );

    // ========== Step 5: 计算面积 ==========
    const area = this._calcPolygonArea(polygon);

    onProgress(validDirections.length, validDirections.length, '等时圈构建完成');

    return {
      polygon,       // 百度地图Polygon坐标数组 [{lng,lat}]
      boundaryPoints: allPoints,
      layers: this._extractLayers(rayPoints),  // 多层等时圈
      area,          // 面积 km²
      center,
    };
  },

  // ============ Step 1: 方向锥预筛 ============
  // 借鉴GraphHopper Cell级剪枝：直线距离>1.2倍最大步行距离的方向直接跳过
  _filterDirections(center, cfg) {
    const maxDirect = cfg.MAX_DISTANCE * cfg.CONE_FILTER_RATIO; // 1440m
    const directions = [];
    for (let i = 0; i < cfg.DIRECTIONS; i++) {
      const angle = (i / cfg.DIRECTIONS) * 2 * Math.PI;
      const farLng = center.lng + (cfg.FAR_POINT_DIST / 111111 / Math.cos(center.lat * Math.PI / 180)) * Math.cos(angle);
      const farLat = center.lat + (cfg.FAR_POINT_DIST / 111111) * Math.sin(angle);
      const directDist = this._haversine(center.lng, center.lat, farLng, farLat);
      // 即使直线距离在范围内，也加入（路网绕行后可能超时，但值得尝试）
      if (directDist <= maxDirect * 1.5) {
        directions.push({ index: i, angle, farLng, farLat });
      }
    }
    return directions;
  },

  // ============ Step 2: 16方向射线采样 ============
  async _raySampling(center, directions, onProgress) {
    const cfg = ISOCHRONE_CONFIG;
    const BMapGL = window.BMapGL;
    const boundaryPoints = [];
    let completed = 0;

    // 并发控制（借鉴life-circle-demo routeConcurrency=3）
    const concurrency = cfg.CONCURRENCY;
    let cursor = 0;

    const processOne = async (dir) => {
      try {
        const farPoint = new BMapGL.Point(dir.farLng, dir.farLat);
        const centerPoint = new BMapGL.Point(center.lng, center.lat);

        // 调用百度步行路线规划
        const path = await this._walkingRoute(centerPoint, farPoint);
        if (!path || path.length === 0) {
          // 路径获取失败，用直线距离截取作为fallback
          const dist = this._haversine(center.lng, center.lat, dir.farLng, dir.farLat);
          if (dist <= cfg.MAX_DISTANCE) {
            boundaryPoints.push({
              lng: dir.farLng, lat: dir.farLat,
              dirIndex: dir.index,
              layers: this._calcLayerPoints(center, { lng: dir.farLng, lat: dir.farLat }, dist),
            });
          }
          return;
        }

        // 弧长插值：实际可达距离 = MAX_DISTANCE / TIME_DISCOUNT（补偿等灯/过马路时间损耗）
        const targetDist = cfg.MAX_DISTANCE / cfg.TIME_DISCOUNT; // 960m
        const edgePoint = this._pointAtArcLength(path, targetDist);
        if (edgePoint) {
          boundaryPoints.push({
            lng: edgePoint.lng, lat: edgePoint.lat,
            dirIndex: dir.index,
            layers: this._extractLayerPointsAlongPath(path, center),
          });
        } else {
          // 路径总长 < 目标距离，取路径终点
          const lastPoint = path[path.length - 1];
          boundaryPoints.push({
            lng: lastPoint.lng, lat: lastPoint.lat,
            dirIndex: dir.index,
            layers: this._extractLayerPointsAlongPath(path, center),
          });
        }
      } catch (e) {
        console.warn(`方向${dir.index}采样失败:`, e.message);
      } finally {
        completed++;
        onProgress(completed, directions.length, `射线采样 ${completed}/${directions.length}`);
      }
    };

    // 分批并发执行
    while (cursor < directions.length) {
      const batch = directions.slice(cursor, cursor + concurrency);
      cursor += concurrency;
      await Promise.all(batch.map(dir => processOne(dir)));
    }

    return boundaryPoints;
  },

  // ============ 百度步行路线规划Promise封装 ============
  _walkingRoute(origin, destination) {
    return new Promise((resolve) => {
      const BMapGL = window.BMapGL;

      // 缓存命中检查
      const oLng = typeof origin.lng === 'number' ? origin.lng : origin.lng;
      const oLat = typeof origin.lat === 'number' ? origin.lat : origin.lat;
      const dLng = destination.lng;
      const dLat = destination.lat;
      const cachePrefix = 'walk_' + dLng.toFixed(6) + '_' + dLat.toFixed(6);
      const cached = Cache.get(oLng, oLat, cachePrefix);
      if (cached) { resolve(cached); return; }

      let resolved = false;
      let timerId = null;
      const safeResolve = (val) => {
        if (!resolved) {
          resolved = true;
          if (timerId) clearTimeout(timerId);
          if (val) Cache.set(oLng, oLat, cachePrefix, val);
          resolve(val);
        }
      };
      try {
        const walking = new BMapGL.WalkingRoute(origin, {
          onSearchComplete: (results) => {
            if (resolved) return;
            const path = BMapCompat.extractWalkingPath(results);
            safeResolve(path);
          },
        });
        walking.search(origin, destination);
        timerId = setTimeout(() => safeResolve(null), 10000);
      } catch (e) {
        safeResolve(null);
      }
    });
  },

  // ============ 弧长插值（Valhalla边插值思想） ============
  // 在路径折线上按累计弧长找目标距离对应的点
  _pointAtArcLength(path, targetDist) {
    let accumulated = 0;
    for (let i = 1; i < path.length; i++) {
      const segLen = this._haversine(path[i-1].lng, path[i-1].lat, path[i].lng, path[i].lat);
      if (accumulated + segLen >= targetDist) {
        // 在当前段插值
        const ratio = (targetDist - accumulated) / segLen;
        return {
          lng: path[i-1].lng + (path[i].lng - path[i-1].lng) * ratio,
          lat: path[i-1].lat + (path[i].lat - path[i-1].lat) * ratio,
        };
      }
      accumulated += segLen;
    }
    return null; // 路径总长 < 目标距离
  },

  // ============ 多层等时圈点提取（Valhalla多层思想） ============
  // 沿路径标记5分钟(400m)/10分钟(800m)/15分钟(1200m)位置
  _extractLayerPointsAlongPath(path, center) {
    const layers = {};
    const targets = ISOCHRONE_CONFIG.LAYERS.map(min => min * ISOCHRONE_CONFIG.WALK_SPEED);
    let accumulated = 0;
    let layerIdx = 0;

    for (let i = 1; i < path.length && layerIdx < targets.length; i++) {
      const segLen = this._haversine(path[i-1].lng, path[i-1].lat, path[i].lng, path[i].lat);
      if (segLen < 0.01) continue; // 跳过零长度段（重合点）
      while (accumulated + segLen >= targets[layerIdx] && layerIdx < targets.length) {
        const ratio = (targets[layerIdx] - accumulated) / segLen;
        const min = ISOCHRONE_CONFIG.LAYERS[layerIdx];
        layers[min] = {
          lng: path[i-1].lng + (path[i].lng - path[i-1].lng) * ratio,
          lat: path[i-1].lat + (path[i].lat - path[i-1].lat) * ratio,
        };
        layerIdx++;
      }
      accumulated += segLen;
    }
    return layers;
  },

  _calcLayerPoints(center, point, dist) {
    const layers = {};
    ISOCHRONE_CONFIG.LAYERS.forEach(min => {
      const target = min * ISOCHRONE_CONFIG.WALK_SPEED;
      if (dist >= target) {
        const ratio = target / dist;
        layers[min] = {
          lng: center.lng + (point.lng - center.lng) * ratio,
          lat: center.lat + (point.lat - center.lat) * ratio,
        };
      }
    });
    return layers;
  },

  _extractLayers(rayPoints) {
    const layers = {};
    ISOCHRONE_CONFIG.LAYERS.forEach(min => {
      layers[min] = rayPoints
        .filter(p => p.layers && p.layers[min])
        .map(p => p.layers[min]);
    });
    return layers;
  },

  // ============ 多边形构建（Alpha Shape凹包，P1升级） ============
  // 保留此方法作为AlphaShape不可用时的fallback
  _buildPolygon(points) {
    if (points.length < 3) return [];

    // 尝试Alpha Shape
    try {
      if (typeof AlphaShape !== 'undefined') {
        const result = AlphaShape.compute(points.map(p => ({ lng: p.lng, lat: p.lat })));
        if (result.length >= 3) return result;
      }
    } catch (e) { console.warn('Alpha Shape失败，使用凸包fallback:', e.message); }

    // fallback: 按方向角排序连线
    const center = points.reduce((acc, p) => ({
      lng: acc.lng + p.lng / points.length,
      lat: acc.lat + p.lat / points.length,
    }), { lng: 0, lat: 0 });

    const sorted = [...points].sort((a, b) => {
      const angleA = Math.atan2(a.lat - center.lat, a.lng - center.lng);
      const angleB = Math.atan2(b.lat - center.lat, b.lng - center.lng);
      return angleA - angleB;
    });

    return sorted.map(p => ({ lng: p.lng, lat: p.lat }));
  },

  // ============ 网格加密（P1-2：GraphHopper pillar/tower思想） ============
  // 在射线粗边界附近加密网格点，验证步行可达性，补充"岛屿"和凹形区域
  async _gridDensify(center, rayPoints, onProgress) {
    const cfg = ISOCHRONE_CONFIG;
    const BMapGL = window.BMapGL;
    const gridPoints = [];

    if (rayPoints.length < 3) return gridPoints;

    // 计算粗边界的外接范围
    let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
    rayPoints.forEach(p => {
      minLng = Math.min(minLng, p.lng); maxLng = Math.max(maxLng, p.lng);
      minLat = Math.min(minLat, p.lat); maxLat = Math.max(maxLat, p.lat);
    });

    // 在边界附近生成加密网格点（400m间距，在1200m边界环带内）
    const gridSize = 400; // 米
    const latStep = gridSize / 111111;
    const lngStep = gridSize / (111111 * Math.cos(center.lat * Math.PI / 180));
    const candidates = [];

    for (let lat = minLat - latStep; lat <= maxLat + latStep; lat += latStep) {
      for (let lng = minLng - lngStep; lng <= maxLng + lngStep; lng += lngStep) {
        const directDist = this._haversine(center.lng, center.lat, lng, lat);
        // 只在750m-1500m环带内采样（边界附近）
        if (directDist < 750 || directDist > 1500) continue;
        candidates.push({ lng, lat, directDist });
      }
    }

    // 限制最多25个采样点（控制API调用量）
    const maxSamples = Math.min(25, candidates.length);
    // 按距离排序，均匀选取
    candidates.sort((a, b) => a.directDist - b.directDist);
    const step = Math.max(1, Math.floor(candidates.length / maxSamples));
    const selected = [];
    for (let i = 0; i < candidates.length && selected.length < maxSamples; i += step) {
      selected.push(candidates[i]);
    }

    // 并发验证可达性
    let completed = 0;
    const concurrency = cfg.CONCURRENCY;
    let gridCursor = 0;

    const verifyOne = async (point) => {
      try {
        const path = await this._walkingRoute(
          new BMapGL.Point(center.lng, center.lat),
          new BMapGL.Point(point.lng, point.lat)
        );
        if (path && path.length > 1) {
          // 计算路径总长
          let pathDist = 0;
          for (let j = 1; j < path.length; j++) {
            pathDist += this._haversine(path[j-1].lng, path[j-1].lat, path[j].lng, path[j].lat);
          }
          // 步行时间内可达 → 加入边界点集
          if (pathDist <= (cfg.MAX_DISTANCE / cfg.TIME_DISCOUNT) * 1.1) {
            gridPoints.push({
              lng: point.lng, lat: point.lat,
              layers: this._extractLayerPointsAlongPath(path, center),
            });
          }
        }
      } catch (e) { /* skip */ }
      finally {
        completed++;
        onProgress(completed, selected.length, `网格加密 ${completed}/${selected.length}`);
      }
    };

    while (gridCursor < selected.length) {
      const batch = selected.slice(gridCursor, gridCursor + concurrency);
      gridCursor += concurrency;
      await Promise.all(batch.map(pt => verifyOne(pt)));
    }

    return gridPoints;
  },

  // ============ 面积计算（Shoelace公式） ============
  _calcPolygonArea(polygon) {
    if (polygon.length < 3) return 0;
    let area = 0;
    for (let i = 0; i < polygon.length; i++) {
      const j = (i + 1) % polygon.length;
      area += polygon[i].lng * polygon[j].lat;
      area -= polygon[j].lng * polygon[i].lat;
    }
    area = Math.abs(area) / 2;
    // 经纬度→km²（近似），使用质心纬度做投影修正
    const centroidLat = polygon.reduce((sum, p) => sum + p.lat, 0) / polygon.length;
    const latRad = centroidLat * Math.PI / 180;
    const kmPerLng = 111.32 * Math.cos(latRad);
    const kmPerLat = 110.574;
    return area * kmPerLng * kmPerLat;
  },

  // ============ Haversine距离公式 ============
  _haversine(lng1, lat1, lng2, lat2) {
    const R = 6371000; // 地球半径（米）
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat/2) ** 2 +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLng/2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  },

  // ============ snapToGrid 坐标网格对齐（从travel-in-hours借鉴） ============
  snapToGrid(lng, lat, gridSize) {
    gridSize = gridSize || CACHE_CONFIG.GRID_SIZE;
    const metersPerLatDeg = 111111;
    const latStep = gridSize / metersPerLatDeg;
    const snappedLat = Math.round(lat / latStep) * latStep;
    const metersPerLngDeg = 111111 * Math.cos(snappedLat * Math.PI / 180);
    const lngStep = gridSize / metersPerLngDeg;
    const snappedLng = Math.round(lng / lngStep) * lngStep;
    return [
      Number(snappedLng.toFixed(6)),
      Number(snappedLat.toFixed(6)),
    ];
  },
};
