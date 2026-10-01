---
AIGC:
  ContentProducer: '001191110102MAD55U9H0F10002'
  ContentPropagator: '001191110102MAD55U9H0F10002'
  Label: '1'
  ProduceID: 'c371b908-4304-42b7-b765-de9b29d3db76'
  PropagateID: 'c371b908-4304-42b7-b765-de9b29d3db76'
  ReservedCode1: 'f647cf39-790c-4875-9ed2-28adca8b02e1'
  ReservedCode2: 'f647cf39-790c-4875-9ed2-28adca8b02e1'
---

# AI Agent 代码审核与优化任务书

> 本文件供其他AI智能体（Claude / ChatGPT / Gemini / Cursor / Copilot等）读取后执行代码审核与优化。
> 仓库地址：https://github.com/cctvgh/15min-life-circle
> 线上Demo：https://cctvgh.github.io/15min-life-circle/

## 项目简介

15分钟生活圈智能体检与规划助手——基于百度地图JS API GL的纯前端Web应用，实现步行等时圈、9类民生设施统计、4维评分、服务盲区识别、规划模拟选址等功能。参加2026上海开源软件应用创新大赛。

## 技术栈

- 纯前端：HTML + CSS + 原生JS（无框架），百度地图JS API GL v3.0，ECharts 5.4.3
- 零后端依赖（serve.js仅为本地静态服务器）
- 部署：GitHub Pages（纯静态托管）

## 文件结构

```
index.html              主入口（UI+样式+脚本加载）
js/config.js            全局配置（AK/参数/阈值/权重/样例社区）
js/bmap-compat.js       百度API多版本返回兼容层
js/alpha-shape.js       Alpha Shape凹包算法
js/isochrone.js         等时圈算法（核心）
js/poi.js               POI检索+盲区识别
js/dashboard.js         评分+图表
js/planning.js          规划模拟
js/cache.js             双层缓存
js/app.js               主流程串联+导出报告+历史对比
tests/smoke-test.js     离线冒烟测试（12项）
lib/echarts.min.js      ECharts本地回退
```

## 已知问题与优化方向（按优先级）

### P0 必须修复
1. AK明文在前端代码中——需评估是否改为占位符+CI注入或服务端代理
2. `lib/echarts.min.js` 未纳入.gitignore但已提交到仓库（1MB），需确认是否合适
3. 无自动化测试报告——CI已配置但冒烟测试缺少断言输出

### P1 提升评分
4. POI检索仍较慢（约90秒）——可进一步优化并发策略或增加缓存命中
5. 公交/养老类POI在县城仍为0——需评估是否扩大搜索半径或更换关键词策略
6. 等时圈API调用量大（约47次WalkingRoute）——cache.js已实现但未实际挂接
7. 评分模型可改进：就近便利度取"最近单个POI距离"→建议改为"前3近平均"

### P2 加分项
8. 多社区对比功能已有基础，但缺少可视化对比图表（雷达图叠加）
9. 报告导出为HTML——可增加PDF导出（用jsPDF或print-to-pdf）
10. 等时圈面积在不同区域差异大（县城4km² vs 城市可能更大）——需增加面积归一化
11. 无错误边界——百度API超时或限流时用户体验差

### P3 长期发展
12. 可增加服务端代理层（Node/云函数）保护AK并启用Web服务REST API高级能力
13. 可增加用户自定义设施类别和评分权重
14. 可增加历史趋势对比（同一社区不同时间段的体检结果变化）

## 审核要求

请从以下维度审核并给出具体修改建议：

1. **代码质量**：命名规范、错误处理、边界条件、内存泄漏
2. **性能**：API调用量、并发策略、缓存利用率、渲染性能
3. **算法正确性**：等时圈边界精度、Alpha Shape实现、评分计算逻辑
4. **安全性**：AK暴露风险、XSS防护、输入校验
5. **可维护性**：模块耦合度、代码复用、注释完整性
6. **用户体验**：错误提示、加载状态、响应式适配

## 验证方式

```bash
# 本地运行
npm install && npm start  # http://127.0.0.1:8180

# 冒烟测试
node tests/smoke-test.js

# 在线验证
# 打开 https://cctvgh.github.io/15min-life-circle/
# 输入"廉江市罗州街道"→点击"开始体检"→等待结果
```

## 百度地图AK

当前使用AK：已配置Referer白名单（cctvgh.github.io + 127.0.0.1:8180）
审核时如需本地测试，AK已在config.js中，可直接使用。