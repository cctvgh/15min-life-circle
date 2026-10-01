/**
 * alpha-shape.js - Alpha Shape凹包算法（纯JS实现，零依赖）
 * 借鉴: pgRouting pgr_alphaShape + Valhalla Concave Hull
 * 
 * 原理:
 * 1. 对边界点集做Delaunay三角剖分（Bowyer-Watson算法）
 * 2. 计算每个三角形的外接圆半径
 * 3. 删除外接圆半径 > alpha 的三角形（"太扁"的三角形不属于等时圈内部）
 * 4. 剩余三角形的外轮廓边 = Alpha Shape边界
 * 
 * alpha参数自适应: alpha = 1.5 × 平均Delaunay边长（从pgRouting借鉴）
 */

const AlphaShape = {

  /**
   * 生成Alpha Shape边界多边形
   * @param {Array} points - 输入点集 [{lng, lat}]
   * @param {Number} alphaParam - 可选，alpha半径（米），不传则自适应
   * @returns {Array} 边界多边形顶点 [{lng, lat}]（按顺序排列）
   */
  compute(points, alphaParam) {
    if (!points || points.length < 3) return points || [];

    // 转为平面坐标（以中心点为原点，米为单位）
    const center = this._centroid(points);
    const planar = points.map(p => this._toPlanar(p, center));

    // Step 1: Delaunay三角剖分
    const triangles = this._delaunay(planar);
    if (triangles.length === 0) return this._convexHullFallback(planar, center);

    // Step 2: 计算平均边长（用于自适应alpha）
    let totalEdgeLen = 0, edgeCount = 0;
    triangles.forEach(tri => {
      for (let i = 0; i < 3; i++) {
        const j = (i + 1) % 3;
        totalEdgeLen += this._dist(planar[tri[i]], planar[tri[j]]);
        edgeCount++;
      }
    });
    const avgEdgeLen = edgeCount > 0 ? totalEdgeLen / edgeCount : 100;
    const alpha = alphaParam || avgEdgeLen * 1.5;

    // Step 3: 筛选外接圆半径 <= alpha 的三角形
    const keptTriangles = [];
    triangles.forEach(tri => {
      const cr = this._circumradius(planar[tri[0]], planar[tri[1]], planar[tri[2]]);
      if (cr <= alpha) keptTriangles.push(tri);
    });

    if (keptTriangles.length === 0) return this._convexHullFallback(planar, center);

    // Step 4: 提取边界边（只被一个三角形使用的边）
    const edgeMap = new Map();
    const edgeKey = (a, b) => a < b ? `${a}-${b}` : `${b}-${a}`;

    keptTriangles.forEach(tri => {
      for (let i = 0; i < 3; i++) {
        const j = (i + 1) % 3;
        const key = edgeKey(tri[i], tri[j]);
        if (edgeMap.has(key)) edgeMap.delete(key);
        else edgeMap.set(key, [tri[i], tri[j]]);
      }
    });

    // Step 5: 将边界边连接成有序环（返回顶点索引）
    const boundaryEdges = [...edgeMap.values()];
    const polygonIndices = this._connectEdges(boundaryEdges);
    const polygonPlanar = polygonIndices.map(i => planar[i]);

    // 转回经纬度
    return polygonPlanar.map(p => this._fromPlanar(p, center));
  },

  // ============ Delaunay三角剖分（Bowyer-Watson算法） ============
  _delaunay(points) {
    const n = points.length;
    if (n < 3) return [];

    // 创建超三角形（包含所有点）
    const minX = Math.min(...points.map(p => p.x));
    const maxX = Math.max(...points.map(p => p.x));
    const minY = Math.min(...points.map(p => p.y));
    const maxY = Math.max(...points.map(p => p.y));
    const dx = maxX - minX || 1, dy = maxY - minY || 1;
    const midX = (minX + maxX) / 2, midY = (minY + maxY) / 2;
    const dmax = Math.max(dx, dy) * 20;

    const pts = [...points.map(p => ({ ...p }))];
    // 超三角形的三个顶点（索引 n, n+1, n+2）
    pts.push({ x: midX - dmax, y: midY - dmax });
    pts.push({ x: midX + dmax, y: midY - dmax });
    pts.push({ x: midX, y: midY + dmax });

    let triangles = [[n, n+1, n+2]];

    // 逐点插入
    for (let i = 0; i < n; i++) {
      const p = pts[i];
      const badTriangles = [];
      const edges = [];

      // 找出外接圆包含p的三角形
      triangles.forEach((tri, idx) => {
        const cr = this._circumradius(pts[tri[0]], pts[tri[1]], pts[tri[2]]);
        const cc = this._circumcenter(pts[tri[0]], pts[tri[1]], pts[tri[2]]);
        if (this._dist(p, cc) <= cr) {
          badTriangles.push(idx);
          edges.push([tri[0], tri[1]], [tri[1], tri[2]], [tri[2], tri[0]]);
        }
      });

      // 移除坏三角形
      triangles = triangles.filter((_, idx) => !badTriangles.includes(idx));

      // 找多边形洞的边界边（出现一次的边）
      const edgeCount = {};
      edges.forEach(([a, b]) => {
        const key = a < b ? `${a}-${b}` : `${b}-${a}`;
        edgeCount[key] = (edgeCount[key] || 0) + 1;
      });
      const boundaryEdges = edges.filter(([a, b]) => {
        const key = a < b ? `${a}-${b}` : `${b}-${a}`;
        return edgeCount[key] === 1;
      });

      // 重新三角化
      boundaryEdges.forEach(([a, b]) => {
        triangles.push([a, b, i]);
      });
    }

    // 移除包含超三角形顶点的三角形
    triangles = triangles.filter(tri =>
      tri[0] < n && tri[1] < n && tri[2] < n
    );

    return triangles;
  },

  // ============ 外接圆半径 ============
  _circumradius(a, b, c) {
    const ab = this._dist(a, b);
    const bc = this._dist(b, c);
    const ca = this._dist(c, a);
    const s = (ab + bc + ca) / 2;
    const area = Math.sqrt(Math.max(s * (s-ab) * (s-bc) * (s-ca), 0.000001));
    return (ab * bc * ca) / (4 * area);
  },

  // ============ 外接圆心 ============
  _circumcenter(a, b, c) {
    const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
    if (Math.abs(d) < 1e-10) return { x: a.x, y: a.y };
    const ux = ((a.x**2 + a.y**2) * (b.y - c.y) + (b.x**2 + b.y**2) * (c.y - a.y) + (c.x**2 + c.y**2) * (a.y - b.y)) / d;
    const uy = ((a.x**2 + a.y**2) * (c.x - b.x) + (b.x**2 + b.y**2) * (a.x - c.x) + (c.x**2 + c.y**2) * (b.x - a.x)) / d;
    return { x: ux, y: uy };
  },

  // ============ 边连接成环（返回顶点索引数组） ============
  _connectEdges(edges) {
    if (edges.length === 0) return [];
    const visited = new Set();
    const ring = [];
    let current = edges[0];
    ring.push(current[0]);
    visited.add(0);

    while (visited.size < edges.length) {
      let found = false;
      for (let i = 0; i < edges.length; i++) {
        if (visited.has(i)) continue;
        const [a, b] = edges[i];
        const last = ring[ring.length - 1];
        if (a === last) { ring.push(b); visited.add(i); found = true; break; }
        if (b === last) { ring.push(a); visited.add(i); found = true; break; }
      }
      if (!found) break; // 无法连接（可能多个环）
    }
    return ring; // 顶点索引数组
  },

  // ============ 凸包fallback（当alpha筛选后无三角形时） ============
  _convexHullFallback(planar, center) {
    // Andrew's monotone chain算法
    const pts = [...planar].sort((a, b) => a.x - b.x || a.y - b.y);
    const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    const lower = [], upper = [];
    for (const p of pts) {
      while (lower.length >= 2 && cross(lower[lower.length-2], lower[lower.length-1], p) <= 0) lower.pop();
      lower.push(p);
    }
    for (let i = pts.length - 1; i >= 0; i--) {
      const p = pts[i];
      while (upper.length >= 2 && cross(upper[upper.length-2], upper[upper.length-1], p) <= 0) upper.pop();
      upper.push(p);
    }
    lower.pop(); upper.pop();
    const hull = [...lower, ...upper];
    return hull.map(p => this._fromPlanar(p, center));
  },

  // ============ 坐标转换工具 ============
  _centroid(points) {
    const sum = points.reduce((acc, p) => ({ lng: acc.lng + p.lng, lat: acc.lat + p.lat }), { lng: 0, lat: 0 });
    return { lng: sum.lng / points.length, lat: sum.lat / points.length };
  },

  _toPlanar(p, center) {
    const R = 6378137;
    const x = (p.lng - center.lng) * Math.PI / 180 * R * Math.cos(center.lat * Math.PI / 180);
    const y = (p.lat - center.lat) * Math.PI / 180 * R;
    return { x, y };
  },

  _fromPlanar(p, center) {
    const R = 6378137;
    const lng = center.lng + p.x / (R * Math.cos(center.lat * Math.PI / 180)) * 180 / Math.PI;
    const lat = center.lat + p.y / R * 180 / Math.PI;
    return { lng, lat };
  },

  _dist(a, b) {
    return Math.sqrt((a.x - b.x)**2 + (a.y - b.y)**2);
  },
};
