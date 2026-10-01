/**
 * record-demo.js - 录制演示视频
 * 用Playwright录制15分钟生活圈完整操作流程
 * 输出: videos/demo-*.webm（可再用ffmpeg转mp4）
 */
const { chromium } = require('playwright-core');
const path = require('path');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE_URL = process.env.DEMO_URL || 'http://127.0.0.1:8180';
const OUT_DIR = path.join(__dirname, '..', 'videos');

(async () => {
  console.log('[1/6] 启动浏览器...');
  const browser = await chromium.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-gpu'],
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    recordVideo: {
      dir: OUT_DIR,
      size: { width: 1440, height: 900 },
    },
  });

  const page = await context.newPage();
  let progressPct = -1;

  // ===== 1. 打开页面 =====
  console.log('[2/4] 打开应用页面...');
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(15000); // 等待百度地图加载（headless较慢）
  try {
    await page.waitForFunction(() => window.App && window.App.map, { timeout: 60000 });
    console.log('   - 地图已加载');
  } catch (e) {
    console.log('   - 地图加载超时（继续，尝试等待重试）');
    await page.waitForTimeout(15000);
  }

  // 提示文案
  await page.evaluate(() => {
    const hint = document.querySelector('.map-hint');
    if (hint) hint.textContent = '演示：廉江市罗州街道 15分钟生活圈体检';
  });
  await page.waitForTimeout(3000);

  // ===== 2. 输入地址并开始体检 =====
  console.log('[3/4] 输入地址并启动体检...');
  await page.evaluate(() => {
    document.getElementById('address-input').value = '廉江市罗州街道';
    document.getElementById('coord-display').value = '110.2856, 21.6218';
  });
  await page.waitForTimeout(1500);
  try {
    await page.click('#btn-analyze');
    console.log('   - 已点击开始体检');
  } catch (e) {
    console.log('   - 按钮点击失败，尝试直接调用');
    await page.evaluate(() => App.runAnalysis());
  }

  // ===== 3. 等待分析完成 =====
  console.log('   等待分析完成（约2-4分钟）...');
  const deadline = Date.now() + 6 * 60 * 1000;
  while (Date.now() < deadline) {
    const state = await page.evaluate(() => {
      const bar = document.getElementById('progress-bar');
      const text = document.getElementById('progress-text');
      const error = document.getElementById('error-message');
      return {
        pct: bar ? bar.style.width : '0%',
        msg: text ? text.textContent : '',
        err: error && error.style.display !== 'none' ? error.textContent : '',
        poi: document.getElementById('poi-total') ? document.getElementById('poi-total').textContent : '-',
      };
    }).catch(() => null);
    if (!state) break;
    const pctNum = parseFloat(state.pct) || 0;
    if (pctNum !== progressPct) {
      progressPct = pctNum;
      console.log(`   - 进度: ${state.pct} ${state.msg}`);
    }
    if (state.err) { console.error('分析失败:', state.err); break; }
    if (pctNum >= 100) { console.log('   - 分析完成!'); break; }
    await page.waitForTimeout(2000);
  }
  await page.waitForTimeout(3000);

  // ===== 4. 展示结果 =====
  console.log('[4/4] 展示结果...');
  // 顶部（地图+评分环+雷达图）
  await page.evaluate(() => {
    const sidebar = document.querySelector('.sidebar');
    if (sidebar) sidebar.scrollTop = 0;
  });
  await page.waitForTimeout(6000);

  // 中部（柱状图）
  await page.evaluate(() => {
    const sidebar = document.querySelector('.sidebar');
    if (sidebar) sidebar.scrollTop = 500;
  });
  await page.waitForTimeout(6000);

  // 底部（报告+规划建议）
  await page.evaluate(() => {
    const sidebar = document.querySelector('.sidebar');
    if (sidebar) sidebar.scrollTop = 1200;
  });
  await page.waitForTimeout(6000);

  // 回到顶部结束
  await page.evaluate(() => {
    const sidebar = document.querySelector('.sidebar');
    if (sidebar) sidebar.scrollTop = 0;
  });
  await page.waitForTimeout(3000);

  console.log('关闭浏览器，保存视频...');
  await context.close();
  await browser.close();

  console.log('录制完成，视频位于:', OUT_DIR);
})().catch(e => {
  console.error('录制失败:', e);
  process.exit(1);
});