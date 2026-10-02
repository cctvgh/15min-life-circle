/**
 * check_network.js - 15分钟生活圈批量补跑前网络预检
 * 检测批量补跑所依赖的外部域名可达性（DNS + 连通），避免在网络不稳时段跑出失真数据。
 * 用法：node scripts/check_network.js
 * 返回：全部可达 exit 0；任一不可达 exit 1（建议网络稳定后再跑）。
 */
const http = require('http');
const https = require('https');

const TARGETS = [
  { name: '百度地图API(核心)', url: 'https://api.map.baidu.com' },
  { name: '百度瓦片/检索',     url: 'https://maponline0.bdimg.com' },
  { name: '智谱GLM(LLM)',     url: 'https://open.bigmodel.cn/api/paas/v4/chat/completions' },
];

function probe(url, timeoutMs) {
  return new Promise((resolve) => {
    const lib = url.startsWith('https') ? https : http;
    const t0 = Date.now();
    const req = lib.get(url, { headers: { 'Accept': 'application/json' } }, (res) => {
      res.resume();
      resolve({ ok: true, code: res.statusCode, ms: Date.now() - t0 });
    });
    req.on('error', (e) => {
      resolve({ ok: false, code: (e.code || e.message), ms: Date.now() - t0 });
    });
    req.setTimeout(timeoutMs, () => { req.destroy(new Error('timeout')); });
  });
}

(async () => {
  let allOk = true;
  for (const t of TARGETS) {
    const r = await probe(t.url, 8000);
    if (!r.ok) allOk = false;
    console.log(`${r.ok ? '[OK]  ' : '[FAIL]'} ${t.name}: ${r.code} (${r.ms}ms)`);
  }
  console.log(allOk
    ? '== 网络预检：全部域名可达，可执行批量补跑 =='
    : '== 网络预检：存在不可达域名（多为内网DNS问题），建议网络稳定后重试；LLM 不可达时仅降级AI增强、不影响基础体检 ==');
  process.exit(allOk ? 0 : 1);
})();