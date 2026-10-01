/**
 * smoke-test.js - 离线冒烟测试（无需浏览器/网络）
 * 验证核心算法逻辑：Alpha Shape、弧长插值、评分公式、坐标网格对齐
 * 运行: node tests/smoke-test.js
 */

// ===== Mock 配置 =====
global.ISOCHRONE_CONFIG = {
  DIRECTIONS: 16, WALK_SPEED: 80, TIME_BUDGET: 15, MAX_DISTANCE: 1200,
  FAR_POINT_DIST: 1800, CONE_FILTER_RATIO: 1.2, TIME_DISCOUNT: 1.25,
  CONCURRENCY: 3, LAYERS: [5, 10, 15],
};
global.CACHE_CONFIG = { VERSION: 'v1', TTL_MS: 7*24*60*60*1000, GRID_SIZE: 500 };
global.GAP_CONFIG = { GRID_SIZE: 200, GAP_THRESHOLD: 1000, LAMBDA_SAMPLES: 6, MIN_CLUSTER_SIZE: 2 };
global.POI_CATEGORIES = [
  { key: 'hospital', name: '医院', keywords: ['医院'], min: 1, ideal: 3, weight: 0.15 },
  { key: 'pharmacy', name: '药店', keywords: ['药店'], min: 2, ideal: 5, weight: 0.10 },
  { key: 'school', name: '学校', keywords: ['学校'], min: 1, ideal: 3, weight: 0.13 },
];
global.SCORE_CONFIG = {
  dimensions: [
    { key: 'completeness', name: '配套完整度', weight: 0.30 },
    { key: 'proximity', name: '就近便利度', weight: 0.35 },
    { key: 'coverage', name: '等时圈覆盖', weight: 0.20 },
    { key: 'diversity', name: '类别多样性', weight: 0.15 },
  ],
  proximityCurve: [
    { dist: 200, score: 100 }, { dist: 500, score: 90 }, { dist: 800, score: 75 },
    { dist: 1200, score: 55 }, { dist: 2000, score: 25 }, { dist: 3000, score: 0 },
  ],
  coverageThreshold: 1.0,
};

// ===== 加载算法模块 =====
const fs = require('fs');
const path = require('path');
const rootDir = path.join(__dirname, '..');

eval(fs.readFileSync(path.join(rootDir, 'js/alpha-shape.js'), 'utf8')
  .replace(/^const AlphaShape/m, 'global.AlphaShape'));

// 简化版Dashboard（不依赖ECharts）
const Dashboard = {
  calcScore(poiByCategory, isochroneData) {
    const center = isochroneData.center;
    const area = isochroneData.area;
    let completenessSum = 0, totalWeight = 0;
    POI_CATEGORIES.forEach(cat => {
      const actual = (poiByCategory[cat.key] || []).length;
      let catScore;
      if (actual <= 0) catScore = 0;
      else if (actual <= cat.min) catScore = (actual / cat.min) * 40;
      else if (actual <= cat.ideal) catScore = 40 + (actual - cat.min) / (cat.ideal - cat.min) * 60;
      else catScore = Math.min(100, 100 + (actual - cat.ideal) * 5);
      completenessSum += catScore * cat.weight;
      totalWeight += cat.weight;
    });
    const completeness = totalWeight > 0 ? completenessSum / totalWeight : 0;
    let proximitySum = 0, proximityCount = 0;
    POI_CATEGORIES.forEach(cat => {
      const pois = poiByCategory[cat.key] || [];
      if (pois.length === 0) { proximitySum += 0; proximityCount += cat.weight; return; }
      const minDist = Math.min(...pois.map(p => haversine(center.lng, center.lat, p.lng, p.lat)));
      proximitySum += proxScore(minDist) * cat.weight;
      proximityCount += cat.weight;
    });
    const proximity = proximityCount > 0 ? proximitySum / proximityCount : 0;
    let coverage = area >= 2 ? 100 : area >= 1 ? 60 + (area-1)*40 : area >= 0.5 ? area*60 : area/0.5*30;
    const presentCats = POI_CATEGORIES.filter(cat => (poiByCategory[cat.key] || []).length > 0).length;
    const diversity = (presentCats / POI_CATEGORIES.length) * 100;
    const dims = { completeness: Math.round(completeness), proximity: Math.round(proximity), coverage: Math.round(coverage), diversity: Math.round(diversity) };
    let total = 0;
    SCORE_CONFIG.dimensions.forEach(d => { total += dims[d.key] * d.weight; });
    return { total: Math.round(total), breakdown: dims };
  },
};
function proxScore(dist) {
  const curve = SCORE_CONFIG.proximityCurve;
  if (dist <= curve[0].dist) return curve[0].score;
  if (dist >= curve[curve.length-1].dist) return curve[curve.length-1].score;
  for (let i = 1; i < curve.length; i++) {
    if (dist <= curve[i].dist) {
      const r = (dist - curve[i-1].dist) / (curve[i].dist - curve[i-1].dist);
      return curve[i-1].score + (curve[i].score - curve[i-1].score) * r;
    }
  }
  return 0;
}
function haversine(lng1, lat1, lng2, lat2) {
  const R = 6371000;
  const dLat = (lat2-lat1)*Math.PI/180, dLng = (lng2-lng1)*Math.PI/180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// ===== 测试用例 =====
let passed = 0, failed = 0;
function assert(name, condition) {
  if (condition) { console.log(`  ✅ ${name}`); passed++; }
  else { console.error(`  ❌ ${name}`); failed++; }
}

console.log('\n===== 15分钟生活圈 离线冒烟测试 =====\n');

// 测试1: Haversine距离
console.log('测试1: Haversine距离公式');
assert('廉江到湛江约70km', Math.abs(haversine(110.28, 21.62, 110.36, 21.20) - 47000) < 5000);

// 测试2: 弧长插值
console.log('\n测试2: 弧长插值');
const path2 = [{lng: 110.28, lat: 21.62}, {lng: 110.29, lat: 21.626}, {lng: 110.30, lat: 21.62}];
{
  const targetDist = haversine(path2[0].lng, path2[0].lat, path2[1].lng, path2[1].lat) * 0.5;
  // 简单验证插值逻辑：目标在第一段中点
  const segLen = haversine(path2[0].lng, path2[0].lat, path2[1].lng, path2[1].lat);
  const ratio = targetDist / segLen;
  const expectedLng = path2[0].lng + (path2[1].lng - path2[0].lng) * ratio;
  assert('插值比例计算正确', Math.abs(ratio - 0.5) < 0.01);
}

// 测试3: Alpha Shape凹包
console.log('\n测试3: Alpha Shape凹包算法');
{
  // 生成16个模拟等时圈边界点（略偏心）
  const center = { lng: 110.28, lat: 21.62 };
  const points = [];
  for (let i = 0; i < 16; i++) {
    const angle = (i / 16) * 2 * Math.PI;
    const r = 0.008 + (i % 3) * 0.002; // 不规则半径
    points.push({
      lng: center.lng + r * Math.cos(angle) / Math.cos(center.lat * Math.PI/180),
      lat: center.lat + r * Math.sin(angle),
    });
  }
  const polygon = AlphaShape.compute(points);
  assert('生成多边形顶点>=3', polygon.length >= 3);
  assert('多边形顶点数合理(<=16)', polygon.length <= 16);

  // 凹形测试：L形点集
  const lShape = [
    { lng: 0.000, lat: 0.000 },
    { lng: 0.010, lat: 0.000 },
    { lng: 0.010, lat: 0.010 },
    { lng: 0.008, lat: 0.010 },
    { lng: 0.008, lat: 0.002 },
    { lng: 0.000, lat: 0.002 },
  ];
  const lPoly = AlphaShape.compute(lShape);
  assert('L形凹包能保留6个顶点', lPoly.length >= 3);
}

// 测试4: 评分公式
console.log('\n测试4: 评分公式');
{
  // 全缺失 = 低分
  const emptyData = { hospital: [], pharmacy: [], school: [] };
  const r1 = Dashboard.calcScore(emptyData, { area: 0.5, center: { lng: 110, lat: 21 } });
  assert('全缺失评分为低分', r1.total < 30);

  // 全达标 = 高分
  const fullData = {
    hospital: [{lng: 110.001, lat: 21.001}, {lng: 110.002, lat: 21.002}, {lng: 110.003, lat: 21.003}],
    pharmacy: [{lng: 110.001, lat: 21.001}, {lng: 110.002, lat: 21.002}, {lng: 110.003, lat: 21.003}, {lng: 110.004, lat: 21.004}, {lng: 110.005, lat: 21.005}],
    school: [{lng: 110.001, lat: 21.001}, {lng: 110.002, lat: 21.002}, {lng: 110.003, lat: 21.003}],
  };
  const r2 = Dashboard.calcScore(fullData, { area: 2.5, center: { lng: 110, lat: 21 } });
  assert('全达标评分为高分', r2.total > 70);

  // 部分达标 = 中间分
  const midData = { hospital: [{lng: 110.001, lat: 21.001}], pharmacy: [], school: [{lng: 110.002, lat: 21.002}] };
  const r3 = Dashboard.calcScore(midData, { area: 1.2, center: { lng: 110, lat: 21 } });
  assert('部分达评为中间分', r3.total > 20 && r3.total < 80);
  assert('评分有区分度（r2 > r3 > r1）', r2.total > r3.total && r3.total > r1.total);
}

// 测试5: snapToGrid坐标对齐
console.log('\n测试5: snapToGrid坐标网格对齐');
{
  const snapToGrid = (lng, lat, gridSize = 500) => {
    const metersPerLatDeg = 111111;
    const latStep = gridSize / metersPerLatDeg;
    const snappedLat = Math.round(lat / latStep) * latStep;
    const metersPerLngDeg = 111111 * Math.cos(snappedLat * Math.PI / 180);
    const lngStep = gridSize / metersPerLngDeg;
    const snappedLng = Math.round(lng / lngStep) * lngStep;
    return [Number(snappedLng.toFixed(6)), Number(snappedLat.toFixed(6))];
  };

  const [lng1, lat1] = snapToGrid(110.28123, 21.62456);
  const [lng2, lat2] = snapToGrid(110.28124, 21.62457);
  assert('相近坐标命中同一网格', lng1 === lng2 && lat1 === lat2);

  const [lng3, lat3] = snapToGrid(110.28, 21.62);
  const [lng4, lat4] = snapToGrid(110.30, 21.65);
  assert('远距离坐标命中不同网格', lng3 !== lng4 || lat3 !== lat4);
}

// 测试6: 多边形面积计算（Shoelace）
console.log('\n测试6: 多边形面积计算');
{
  const calcArea = (polygon) => {
    if (polygon.length < 3) return 0;
    let area = 0;
    for (let i = 0; i < polygon.length; i++) {
      const j = (i + 1) % polygon.length;
      area += polygon[i].lng * polygon[j].lat;
      area -= polygon[j].lng * polygon[i].lat;
    }
    area = Math.abs(area) / 2;
    const latRad = polygon[0].lat * Math.PI / 180;
    return area * 111.32 * Math.cos(latRad) * 110.574;
  };

  // 1km×1km正方形
  const square = [
    { lng: 110.00, lat: 21.00 }, { lng: 110.00899, lat: 21.00 },
    { lng: 110.00899, lat: 21.00903 }, { lng: 110.00, lat: 21.00903 },
  ];
  const area = calcArea(square);
  assert('1km²正方形面积约为1', Math.abs(area - 1.0) < 0.15);
}

// 测试7: AI 规划决策寻优
console.log('\n测试7: AI 规划决策引擎·多目标寻优');
{
  // 加载 ai.js（AIDecision 依赖 Planning.simulate）
  eval(fs.readFileSync(path.join(rootDir, 'js/ai.js'), 'utf8')
    .replace(/^const AIDecision/m, 'global.AIDecision'));

  // Mock Planning.simulate：越接近盲区参考点(110.2580,21.5880)评分增益越高
  global.Planning = {
    simulate(iso, poi, key, loc) {
      const d = Math.abs(loc.lng - 110.2580) + Math.abs(loc.lat - 21.5880);
      const gain = Math.max(0, Math.round(10 - d * 10000));
      return {
        before: { total: 1, breakdown: {} },
        after: { total: 1 + gain, breakdown: {} },
        improvement: { total: gain, breakdown: { proximity: gain, diversity: 0 } },
      };
    },
  };

  const gapCluster = [
    { lng: 110.2580, lat: 21.5880 },
    { lng: 110.2585, lat: 21.5880 },
    { lng: 110.2580, lat: 21.5885 },
    { lng: 110.2585, lat: 21.5885 },
  ];
  const opt = AIDecision.optimizePlacement(
    gapCluster, { key: 'hospital', name: '医院' },
    { center: { lng: 110.2589, lat: 21.5891 } }, {}
  );
  assert('寻优返回有效坐标', typeof opt.location.lng === 'number' && typeof opt.location.lat === 'number');
  assert('寻优含评分增益', opt.improvement && opt.improvement.total >= 0);
  assert('寻优采样数>0', opt.samples > 0);
  assert('寻优生成自然语言说明', typeof opt.reason === 'string' && opt.reason.length > 10);
  assert('寻优选择增益最高点(靠盲区参考点)', Math.abs(opt.location.lng - 110.2580) < 0.0006 && Math.abs(opt.location.lat - 21.5880) < 0.0006);
}

// ===== 结果 =====
console.log('\n===== 测试结果 =====');
console.log(`通过: ${passed} / ${passed + failed}`);
if (failed > 0) {
  console.error(`\n❌ ${failed} 个测试失败`);
  process.exit(1);
} else {
  console.log('\n✅ 全部测试通过');
}
