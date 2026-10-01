---
AIGC:
  ContentProducer: '001191110102MAD55U9H0F10002'
  ContentPropagator: '001191110102MAD55U9H0F10002'
  Label: '1'
  ProduceID: 'fe143ee5-bdce-42fb-89fa-fef26a8af6ea'
  PropagateID: 'fe143ee5-bdce-42fb-89fa-fef26a8af6ea'
  ReservedCode1: '3bd18743-8f2c-416e-8cc3-7d4deb9684b3'
  ReservedCode2: '3bd18743-8f2c-416e-8cc3-7d4deb9684b3'
---

# 部署指南

## 线上地址

**GitHub Pages**: https://cctvgh.github.io/15min-life-circle/

## 本地运行

```bash
npm install    # 安装依赖（仅用于本地serve）
npm start      # 启动 http://127.0.0.1:8180
```

或直接用 Docker：

```bash
docker build -t 15min-life-circle .
docker run -p 8180:8180 15min-life-circle
```

## 部署到 GitHub Pages（已完成）

1. 代码已推送至 https://github.com/cctvgh/15min-life-circle （main分支）
2. GitHub Pages 已在仓库 Settings → Pages 中开启（来源：main 分支根目录）

## ⚠️ 必须完成：百度地图AK白名单配置

由于 GitHub Pages 是纯静态托管，前端代码中的AK（`XarFM2yyDSK4Jy99qNAqm8npv8waWAfm`）对所有人可见。
**必须**到百度地图开放平台配置 Referer 白名单，否则AK可能被盗用：

1. 登录 https://lbsyun.baidu.com
2. 进入「控制台」→「应用管理」→「我的应用」
3. 找到本应用 → 「设置」→ 「Referer 白名单」
4. 填入：
   ```
   https://cctvgh.github.io/*
   http://127.0.0.1:8180/*    （本地开发）
   http://localhost:8180/*
   ```
5. 保存后，非白名单域名调用将被百度拒绝，保护AK配额

> 提示：JS API 的配额按"并发"限制不按次数计费，白名单是防止他人盗用的关键手段。

## 常见问题

- **地图空白**：检查 AK 是否失效、白名单是否包含当前域名；检查浏览器控制台报错
- **POI检索慢**：本地串行约3-4分钟，已优化为小批量并发（约1.5-2分钟）
- **等时圈偏差**：步行速度、绕行系数可在 `js/config.js` 的 `ISOCHRONE_CONFIG` / `GAP_CONFIG` 调整

## 版本记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v1.0 | 2026-10-01 | 初始版：等时圈+POI+评分+盲区+规划模拟；修复POI检索0结果bug；部署GitHub Pages |