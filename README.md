---
AIGC:
  ContentProducer: '001191110102MAD55U9H0F10002'
  ContentPropagator: '001191110102MAD55U9H0F10002'
  Label: '1'
  ProduceID: '88c908e0-17e6-4094-83c8-4d5e1d41c89d'
  PropagateID: '88c908e0-17e6-4094-83c8-4d5e1d41c89d'
  ReservedCode1: 'a87778e5-a91d-42b1-907e-4254e9ad312f'
  ReservedCode2: 'a87778e5-a91d-42b1-907e-4254e9ad312f'
---

# 15分钟生活圈 · 智能体检与规划助手

> 基于百度地图开放能力的"15分钟步行等时圈"智能体检与规划系统
> 2026 上海开源软件应用创新大赛 · 开源 AI 工具赛道 · 百度地图赛题参赛作品

## 功能特点

| # | 模块 | 说明 |
|---|------|------|
| 1 | 真实路网等时圈 | 基于百度步行路线规划API + **自适应射线-网格混合算法** + **Alpha Shape凹包**（非简单圆形） |
| 2 | 多层等时圈 | 一次计算生成 5/10/15 分钟三层嵌套，渐变色可视化 |
| 3 | 9类民生设施统计 | 医院/药店/菜市场/商超/学校/公交/养老/文体/绿地，参照住建部《完整居住社区建设标准》 |
| 4 | 4维加权评分 | 配套完整度30% + 就近便利度35% + 等时圈覆盖20% + 类别多样性15%，距离衰减曲线 |
| 5 | 服务盲区识别 | 栅格采样 + 绕行系数λ标定 + 距离场插值 + 连通斑块聚合 |
| 6 | 体检报告 | 概览/优势/不足/盲区/改造建议 五段式，支持打印 |
| 7 | **规划模拟**（核心亮点） | "假设在此新增一所小学，评分提升多少？" 虚拟POI模拟 + 选址建议 |

## 核心算法：自适应射线-网格混合等时圈

```
Step 1: 方向锥预筛     —— 跳过直线距离超出1.2倍步行极限的方向（借鉴 GraphHopper Cell剪枝）
Step 2: 16方向射线采样  —— 百度WalkingRoute真实路径（借鉴 life-circle-demo）
Step 3: 弧长插值       —— 沿路径按1200m累计弧长截取（借鉴 Valhalla 边插值）
Step 4: 网格加密       —— 边界环带内25个采样点验证可达性（借鉴 GraphHopper pillar/tower分级）
Step 5: Alpha Shape    —— Delaunay三角剖分 + 外接圆筛选生成凹多边形（借鉴 pgRouting pgr_alphaShape）
Step 6: snapToGrid缓存  —— 坐标网格对齐 + localStorage缓存（借鉴 travel-in-hours）
```

**与16方向射线直连方案的差异**：多边形边界从16边形升级为Alpha Shape凹多边形，能精确表示河流阻隔形成的U形凹陷和蜿蜒小路到达的"岛屿"区域。

## 快速开始

### 方式A：本地运行

```bash
# 1. 申请百度地图AK（https://lbsyun.baidu.com）
#    应用类型选"浏览器端"

# 2. 替换AK
#    编辑 index.html 中的 __BMAP_AK__，或创建 config.local.js：
echo "window.BMAP_AK_OVERRIDE = '你的AK';" > config.local.js

# 3. 启动本地HTTP服务（file://协议可能被百度Referer白名单拒绝）
python -m http.server 8080
# 或
npx serve -p 8080

# 4. 浏览器打开 http://localhost:8080
```

### 方式B：Docker部署

```bash
docker build -t life-circle .
docker run -e BMAP_AK=你的百度AK -p 8080:80 life-circle
# 浏览器打开 http://localhost:8080
```

### 方式C：Vercel部署

```bash
npm i -g vercel
vercel --prod
# 在Vercel环境变量中设置 BMAP_AK
```

## 离线冒烟测试

```bash
node tests/smoke-test.js
```

验证项：Haversine距离、弧长插值、Alpha Shape凹包（含L形凹形测试）、评分公式（全缺失/全达标/部分达标的区分度）、snapToGrid网格对齐、多边形面积计算。

## 项目结构

```
├── index.html          # 主入口
├── js/
│   ├── config.js       # 全局配置（AK占位符、等时圈参数、POI阈值、评分权重）
│   ├── bmap-compat.js  # 百度API多版本返回兼容层（3种WalkingRoute + 4种LocalSearch）
│   ├── alpha-shape.js  # Alpha Shape凹包算法（纯JS实现，零依赖）
│   ├── isochrone.js    # 自适应射线-网格混合等时圈核心算法
│   ├── poi.js          # POI检索 + 9类设施统计 + 灰色区域识别
│   ├── dashboard.js    # 4维评分 + 雷达图 + 柱状图 + 评分环
│   ├── planning.js     # 规划模拟（虚拟POI + 选址建议）
│   ├── cache.js        # 双层缓存 + snapToGrid
│   └── app.js          # 主流程串联
├── css/                # 样式（内嵌于index.html）
├── tests/
│   └── smoke-test.js   # 离线冒烟测试
├── Dockerfile          # Docker部署
├── vercel.json         # Vercel部署配置
└── README.md
```

## API调用预算

| 接口 | 单次体检调用量 | 免费配额 |
|------|-------------|---------|
| Geocoder | 1次 | 6000次/分钟 |
| WalkingRoute（射线） | 11-16次 | 2000次/分钟 |
| WalkingRoute（网格加密） | ≤25次 | 同上 |
| WalkingRoute（λ标定） | 6次 | 同上 |
| LocalSearch | 9-18次 | 2000次/分钟 |

## 技术栈

- 百度地图 WebGL JS API v3.0
- 原生 JavaScript（ES6+），零框架依赖
- ECharts 5.4.3（CDN + 本地回退）
- Alpha Shape 凹包算法（纯JS实现）

## 许可证

MIT License

## 致谢

算法设计借鉴了以下开源项目的思想：
- [OSRM](https://github.com/Project-OSRM/osrm-backend) — 网格采样 + Alpha Shapes 路线
- [Valhalla](https://github.com/valhalla/valhalla) — 边插值 + 多层等时圈
- [GraphHopper](https://github.com/graphhopper/graphhopper) — Cell级剪枝 + pillar/tower节点分级
- [pgRouting](https://github.com/pgRouting/pgrouting) — pgr_alphaShape 算法
- [travel-in-hours](https://github.com/kuhung/travel-in-hours) — snapToGrid + 双层缓存架构