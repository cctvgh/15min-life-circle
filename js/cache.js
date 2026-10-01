/**
 * cache.js - 双层缓存（从travel-in-hours借鉴）
 * 客户端localStorage缓存 + snapToGrid坐标对齐提升命中率
 */

const Cache = {

  _hits: 0,
  _misses: 0,
  _total: 0,

  /**
   * 生成缓存键（坐标网格对齐后）
   */
  generateKey(lng, lat, prefix) {
    const [glng, glat] = Isochrone.snapToGrid(lng, lat);
    const coordKey = `${glng.toFixed(6)}_${glat.toFixed(6)}`;
    return `${CACHE_CONFIG.VERSION}_${prefix}_${coordKey}`;
  },

  /**
   * 读取缓存
   */
  get(lng, lat, prefix) {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    try {
      const key = this.generateKey(lng, lat, prefix);
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const entry = JSON.parse(raw);
      if (!entry || entry.version !== CACHE_CONFIG.VERSION) {
        localStorage.removeItem(key);
        return null;
      }
      if (Date.now() - entry.timestamp > CACHE_CONFIG.TTL_MS) {
        localStorage.removeItem(key);
        return null;
      }
      this._hits++;
      this._total++;
      return entry.data;
    } catch (e) {
      return null;
    }
  },

  /**
   * 写入缓存
   */
  set(lng, lat, prefix, data) {
    if (typeof window === 'undefined' || !window.localStorage) return;
    try {
      const key = this.generateKey(lng, lat, prefix);
      const entry = {
        version: CACHE_CONFIG.VERSION,
        timestamp: Date.now(),
        data,
      };
      localStorage.setItem(key, JSON.stringify(entry));
      this._misses++;
      this._total++;
    } catch (e) {
      // localStorage可能已满或超出配额，静默降级
      console.warn('缓存写入失败（可能已满）');
    }
  },

  /**
   * 获取缓存统计信息
   */
  getStats() {
    if (typeof window === 'undefined' || !window.localStorage) {
      return { count: 0, sizeBytes: 0, hitRate: 0 };
    }
    let count = 0, sizeBytes = 0;
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(CACHE_CONFIG.VERSION + '_')) {
          count++;
          sizeBytes += (localStorage.getItem(key) || '').length;
        }
      }
    } catch (e) { /* ignore */ }
    return { count, sizeBytes, hitRate: this._hits / Math.max(this._total, 1) };
  },

  /**
   * 清除指定前缀的所有缓存
   */
  clearPrefix(prefix) {
    if (typeof window === 'undefined') return;
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.includes(`_${prefix}_`)) keysToRemove.push(key);
    }
    keysToRemove.forEach(key => localStorage.removeItem(key));
  },

  /**
   * 清除所有缓存
   */
  clearAll() {
    if (typeof window === 'undefined') return;
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(CACHE_CONFIG.VERSION + '_')) keysToRemove.push(key);
    }
    keysToRemove.forEach(key => localStorage.removeItem(key));
  },
};
