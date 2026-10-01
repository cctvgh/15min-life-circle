/**
 * config.js - 全局配置
 * 15分钟生活圈智能体检与规划助手
 */

// 百度地图AK（本地开发用；部署到GitHub时改回占位符 __BMAP_AK__ 由CI注入）
window.BMAP_AK = window.BMAP_AK_OVERRIDE || 'XarFM2yyDSK4Jy99qNAqm8npv8waWAfm';

// ============ 等时圈参数 ============
const ISOCHRONE_CONFIG = {
  DIRECTIONS: 16,           // 射线方向数（每22.5°一个）
  WALK_SPEED: 80,           // 步行速度 m/min（参照住建部标准）
  TIME_BUDGET: 15,          // 时间预算（分钟）
  MAX_DISTANCE: 1200,      // 最大步行距离 = 80×15
  FAR_POINT_DIST: 1800,     // 射线远点距离（留余量）
  CONE_FILTER_RATIO: 1.2,   // 方向锥预筛倍率（直线距离>MAX_DISTANCE×1.2的方向跳过）
  TIME_DISCOUNT: 1.25,      // 步行时间折扣系数（补偿等红灯/过马路）
  CONCURRENCY: 3,           // API并发数
  LAYERS: [5, 10, 15],      // 多层等时圈时间档（分钟）
};

// ============ POI分类与阈值 ============
const POI_CATEGORIES = [
  { key: 'hospital',  name: '医院',   keywords: ['医院', '社区卫生中心'], min: 1, ideal: 3, weight: 0.15 },
  { key: 'pharmacy',  name: '药店',   keywords: ['药店'],                 min: 2, ideal: 5, weight: 0.10 },
  { key: 'market',   name: '菜市场', keywords: ['菜市场', '生鲜超市'],     min: 1, ideal: 3, weight: 0.12 },
  { key: 'supermarket', name: '商超', keywords: ['超市', '便利店'],         min: 2, ideal: 4, weight: 0.10 },
  { key: 'school',   name: '学校',   keywords: ['小学', '中学', '幼儿园'],  min: 1, ideal: 3, weight: 0.13 },
  { key: 'transit',  name: '公交',   keywords: ['公交站', '地铁站'],       min: 1, ideal: 3, weight: 0.10 },
  { key: 'elderly',  name: '养老',   keywords: ['养老院', '社区养老'],     min: 1, ideal: 2, weight: 0.08 },
  { key: 'culture',  name: '文体',   keywords: ['图书馆', '文化活动中心', '体育场馆'], min: 1, ideal: 2, weight: 0.07 },
  { key: 'green',    name: '绿地',   keywords: ['公园', '广场'],           min: 1, ideal: 2, weight: 0.05 },
];

// ============ 评分参数（4维加权） ============
const SCORE_CONFIG = {
  dimensions: [
    { key: 'completeness', name: '配套完整度', weight: 0.30 },
    { key: 'proximity',    name: '就近便利度', weight: 0.35 },
    { key: 'coverage',     name: '等时圈覆盖', weight: 0.20 },
    { key: 'diversity',    name: '类别多样性', weight:  0.15 },
  ],
  // 距离衰减曲线
  proximityCurve: [
    { dist: 200,  score: 100 },
    { dist: 500,  score: 90 },
    { dist: 800,  score: 75 },
    { dist: 1200, score: 55 },
    { dist: 2000, score: 25 },
    { dist: 3000, score: 0 },
  ],
  // 覆盖面积阈值
  coverageThreshold: 1.0, // km²，低于此值严重扣分
};

// ============ 灰色区域参数 ============
const GAP_CONFIG = {
  GRID_SIZE: 200,           // 栅格大小（米）
  GAP_THRESHOLD: 1000,      // 步行距离阈值（米），三类设施均超过才算盲区
  LAMBDA_SAMPLES: 6,        // λ标定采样数
  MIN_CLUSTER_SIZE: 2,      // 最小连通斑块大小
};

// ============ 缓存参数 ============
const CACHE_CONFIG = {
  VERSION: 'v1',
  TTL_MS: 7 * 24 * 60 * 60 * 1000,  // 7天
  GRID_SIZE: 500,                     // snapToGrid网格大小（米）
};

// ============ 主题色 ============
const THEME = {
  primary: '#1a5fb4',
  primaryLight: '#4a90d9',
  bg: '#0f172a',
  card: '#1e293b',
  text: '#e2e8f0',
  textMuted: '#94a3b8',
  border: '#334155',
  green: '#22c55e',
  amber: '#f59e0b',
  red: '#ef4444',
  // 等时圈三层颜色
  layer5: 'rgba(34,197,94,0.15)',
  layer10: 'rgba(74,144,217,0.12)',
  layer15: 'rgba(26,95,180,0.10)',
  layer5Stroke: 'rgba(34,197,94,0.6)',
  layer10Stroke: 'rgba(74,144,217,0.5)',
  layer15Stroke: 'rgba(26,95,180,0.4)',
  gapColor: 'rgba(239,68,68,0.25)',
  gapStroke: 'rgba(239,68,68,0.6)',
};

// ============ 样例社区（湛江廉江） ============
const SAMPLE_COMMUNITIES = [
  { name: '廉江市罗州街道', city: '湛江市', coord: [110.2856, 21.6218] },
  { name: '廉江市城北街道', city: '湛江市', coord: [110.2912, 21.6356] },
  { name: '廉江市吉水镇',   city: '湛江市', coord: [110.2589, 21.5891] },
];
