/**
 * bmap-compat.js - 百度地图API多版本返回兼容层
 * 处理3种WalkingRoute返回 + 4种LocalSearch返回（从life-circle-demo借鉴避坑）
 */

const BMapCompat = {

  // ============ 步行路线规划结果提取 ============
  // 百度WalkingRoute有3种返回结构变体，不做兼容会静默失效
  extractWalkingPath(result) {
    if (!result) return null;

    // 变体1: result.getPlan(0).getRoute(0).getPath()（官方文档写法）
    try {
      const plan = result.getPlan(0);
      if (plan) {
        const route = plan.getRoute(0);
        if (route && route.getPath) {
          const path = route.getPath();
          if (path && path.length > 0) return this._normalizePath(path);
        }
      }
    } catch (e) { /* continue */ }

    // 变体2: result.routes[0].legs[0].steps[].path（类REST格式）
    try {
      if (result.routes && result.routes[0]) {
        const steps = result.routes[0].legs?.[0]?.steps;
        if (steps) {
          const path = [];
          steps.forEach(s => {
            if (s.path) path.push(...this._normalizePath(s.path));
          });
          if (path.length > 0) return path;
        }
      }
    } catch (e) { /* continue */ }

    // 变体3: result.getPlan(0).getPath()（精简返回）
    try {
      const plan = result.getPlan(0);
      if (plan && plan.getPath) {
        const path = plan.getPath();
        if (path && path.length > 0) return this._normalizePath(path);
      }
    } catch (e) { /* continue */ }

    return null;
  },

  // 提取步行时间（秒）
  extractWalkingDuration(result) {
    if (!result) return null;
    // 变体1: getPlan(0).getRoute(0).getDistance()
    try {
      const plan = result.getPlan(0);
      if (plan) {
        const route = plan.getRoute(0);
        if (route && route.getDistance) {
          const dist = route.getDistance(false);
          return dist / ISOCHRONE_CONFIG.WALK_SPEED * 60;
        }
        // 变体3: getPlan(0).getDistance()
        if (plan.getDistance) {
          const dist = plan.getDistance(false);
          return dist / ISOCHRONE_CONFIG.WALK_SPEED * 60;
        }
      }
    } catch (e) { /* continue */ }
    // 变体2: REST格式 result.routes[0].legs[0].distance
    try {
      if (result.routes && result.routes[0]) {
        const leg = result.routes[0].legs?.[0];
        if (leg && leg.distance) {
          return leg.distance.value / ISOCHRONE_CONFIG.WALK_SPEED * 60;
        }
      }
    } catch (e) { /* continue */ }
    return null;
  },

  // ============ POI检索结果提取 ============
  // 百度LocalSearch有4种返回结构变体
  extractPOIs(result) {
    if (!result) return [];

    // 变体1: getCurrentNumPois / getPoi(i)
    try {
      const count = result.getCurrentNumPois ? result.getCurrentNumPois() : 0;
      if (count > 0) {
        const pois = [];
        for (let i = 0; i < count; i++) {
          const poi = result.getPoi(i);
          if (poi) pois.push(this._normalizePOI(poi));
        }
        if (pois.length > 0) return pois;
      }
    } catch (e) { /* continue */ }

    // 变体2: getNumPois / getPoi(i)（旧版接口）
    try {
      const count = result.getNumPois ? result.getNumPois() : 0;
      if (count > 0) {
        const pois = [];
        for (let i = 0; i < count; i++) {
          const poi = result.getPoi(i);
          if (poi) {
            const normalized = this._normalizePOI(poi);
            if (normalized) pois.push(normalized);
          }
        }
        if (pois.length > 0) return pois;
      }
    } catch (e) { /* continue */ }

    // 变体4: 递归扫描对象，找含title+point的数组
    try {
      const found = this._scanForPOIs(result);
      if (found.length > 0) return found;
    } catch (e) { /* continue */ }

    return [];
  },

  // ============ 内部工具方法 ============
  _normalizePath(path) {
    return path.map(p => {
      // 变体A: {lng, lat} 对象
      if (p && typeof p.lng === 'number' && typeof p.lat === 'number') {
        return { lng: p.lng, lat: p.lat };
      }
      // 变体B: [lng, lat] 数组
      if (Array.isArray(p) && p.length >= 2) {
        return { lng: Number(p[0]), lat: Number(p[1]) };
      }
      // 变体C: {x, y} 或 {longitude, latitude}
      if (p && (p.x !== undefined || p.longitude !== undefined)) {
        return { lng: Number(p.lng ?? p.x ?? p.longitude), lat: Number(p.lat ?? p.y ?? p.latitude) };
      }
      console.warn('[BMapCompat] 无法识别的路径点格式:', p);
      return null;
    }).filter(Boolean);
  },

  _normalizePOI(poi) {
    let lng = 0, lat = 0;
    if (poi.point) {
      lng = Number(poi.point.lng ?? poi.point[0] ?? 0);
      lat = Number(poi.point.lat ?? poi.point[1] ?? 0);
    } else if (poi.location) {
      lng = Number(poi.location.lng ?? poi.location[0] ?? 0);
      lat = Number(poi.location.lat ?? poi.location[1] ?? 0);
    }
    // 坐标合法性校验
    if (!isFinite(lng) || !isFinite(lat) || lng === 0 || lat === 0) {
      return null;
    }
    return {
      title: String(poi.title || poi.name || ''),
      lng, lat,
      address: String(poi.address || ''),
      phone: String(poi.phoneNumber || poi.phone || ''),
    };
  },

  _scanForPOIs(obj, depth = 0) {
    if (depth > 3 || !obj) return [];
    if (Array.isArray(obj)) {
      // 检查是否是POI数组
      const pois = obj.filter(item => item && (item.title || item.name) && (item.point || item.location));
      if (pois.length > 0) return pois.map(p => this._normalizePOI(p));
      // 递归扫描子数组
      for (const item of obj) {
        const found = this._scanForPOIs(item, depth + 1);
        if (found.length > 0) return found;
      }
    } else if (typeof obj === 'object') {
      for (const key of Object.keys(obj)) {
        const found = this._scanForPOIs(obj[key], depth + 1);
        if (found.length > 0) return found;
      }
    }
    return [];
  },
};
