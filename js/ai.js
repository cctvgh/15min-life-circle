/**
 * ai.js - AI 规划决策引擎（差异化创新）
 *
 * 将"规划模拟"从"取盲区中心"升级为真正的启发式寻优决策，并支持自然语言规划建议。
 *
 * 三层能力：
 * 1. optimizePlacement —— 多目标启发式寻优：在盲区候选域内采样评估每个落点新增设施
 *    的评分增益，返回增益最大的最优落点（而非简单取盲区中心）。
 * 2. describeDecision —— 自然语言决策说明：将寻优结果转成人类可读的规划建议文案。
 * 3. LLM 网关 —— 预留外部大模型接入：若配置了 window.AI_CONFIG.{enabled,apiKey}，
 *    则调用外部大模型增强建议措辞；否则使用内置规则引擎（离线、确定性、可运行）。
 *
 * 说明：寻优与评分均为确定性算法（可复现），不依赖外部服务即可运行；
 *       LLM 网关用于可选的自然语言润色，不改变核心决策结果。
 */

const AIDecision = {

  // 每个盲区的候选落点采样数（网格 n×n）
  GRID_N: 4,

  /**
   * 多目标启发式寻优选址
   * 在盲区栅格点集的包围盒内做均匀网格采样，逐个候选点评估"新增该设施"的评分增益，
   * 返回增益最大的最优落点（就近便利度 / 类别多样性等维度一并提升）。
   *
   * @param {Array} gapCluster  - 盲区栅格点集 [{lng,lat}]
   * @param {Object} category   - 设施类别 {key,name,min,ideal,weight}
   * @param {Object} isochroneData
   * @param {Object} poiByCategory
   * @returns {Object} { location, before, after, improvement, reason, samples }
   */
  optimizePlacement(gapCluster, category, isochroneData, poiByCategory) {
    // —— 候选域：盲区包围盒（略外扩 10%）——
    let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
    gapCluster.forEach(p => {
      if (p.lng < minLng) minLng = p.lng;
      if (p.lng > maxLng) maxLng = p.lng;
      if (p.lat < minLat) minLat = p.lat;
      if (p.lat > maxLat) maxLat = p.lat;
    });
    const spanLng = (maxLng - minLng) || 0.001;
    const spanLat = (maxLat - minLat) || 0.001;
    const n = Math.max(2, this.GRID_N);

    // —— 网格寻优：评估每个候选落点的评分增量 ——
    let best = null;
    let samples = 0;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const lng = minLng + spanLng * (i + 0.5) / n;
        const lat = minLat + spanLat * (j + 0.5) / n;
        // 该候选点新增设施后的评分变化（复用 Planning.simulate → Dashboard 评分）
        const sim = Planning.simulate(isochroneData, poiByCategory, category.key, { lng, lat });
        samples++;
        if (!best || sim.improvement.total > best.improvement.total) {
          best = { location: { lng, lat }, before: sim.before, after: sim.after, improvement: sim.improvement };
        }
      }
    }

    // —— 自然语言决策说明 ——
    const reason = this._describe(best, category, samples);

    return {
      location: best.location,
      before: best.before,
      after: best.after,
      improvement: best.improvement,
      reason,
      samples,
    };
  },

  /**
   * 生成自然语言决策建议（规则引擎，确定性、可运行；可选由 LLM 润色）
   */
  _describe(decision, category, samples) {
    const p = decision.improvement.breakdown || {};
    const loc = decision.location;
    return `AI 规划决策引擎在盲区 ${samples} 个候选落点中启发式寻优，选取（${loc.lng.toFixed(4)}, ${loc.lat.toFixed(4)}）新增<strong>${category.name}</strong>，评分增益最大：${decision.before.total} → ${decision.after.total}（+${decision.improvement.total} 分），其中就近便利度 +${p.proximity || 0}、类别多样性 +${p.diversity || 0}。`;
  },

  /**
   * 生成规划建议的自然语言摘要（供报告/界面使用）
   * @param {Array} suggestions - suggestLocations 的输出
   * @returns {String}
   */
  summarize(suggestions) {
    if (!suggestions || suggestions.length === 0) {
      return '未发现服务盲区或设施均已达标，暂无需规划调整。';
    }
    return suggestions
      .map(s => `盲区${s.gapIndex + 1}：建议增设${s.category.name}，AI 寻优落点（${s.location.lng.toFixed(4)}, ${s.location.lat.toFixed(4)}），评分 ${s.beforeTotal} → ${s.afterTotal}（+${s.scoreImprovement} 分）。`)
      .join(' ');
  },

  /**
   * LLM 网关：可选外部大模型增强建议文案（智谱 GLM，OpenAI 兼容）
   * 读 window.AI_CONFIG（config.local.js 配置）。未配置 / 调用失败时返回 null，
   * 上层自动降级到内置规则引擎，不影响功能。
   */
  _llmEnabled() {
    const c = window.AI_CONFIG;
    return !!(c && c.enabled && c.apiKey);
  },

  /**
   * 调用智谱 GLM 生成自然语言规划建议
   * @param {String} prompt - 结构化体检/规划数据提示词
   * @param {String} [system] - 系统角色
   * @returns {Promise<String|null>} 生成的文案；失败返回 null
   */
  async _llmGenerate(prompt, system) {
    const cfg = window.AI_CONFIG;
    if (!this._llmEnabled()) return null;
    try {
      const res = await fetch(cfg.baseUrl || 'https://open.bigmodel.cn/api/paas/v4/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.apiKey },
        body: JSON.stringify({
          model: cfg.model || 'glm-4-flash',
          messages: [
            { role: 'system', content: system || '你是社区生活圈规划顾问，请用简洁、专业、可执行的语气给出改进建议，不超过200字。' },
            { role: 'user', content: prompt },
          ],
          temperature: 0.6,
          max_tokens: 500,
        }),
      });
      if (!res.ok) { console.warn('[AI] LLM返回', res.status); return null; }
      const data = await res.json();
      const text = data.choices && data.choices[0] && data.choices[0].message
        ? data.choices[0].message.content : null;
      return text ? String(text).trim() : null;
    } catch (e) {
      console.warn('[AI] LLM调用失败，降级规则引擎:', e.message);
      return null;
    }
  },

  /**
   * 基于体检/规划数据生成"AI 增强建议"（优先 LLM，失败走规则引擎）
   * @param {Object} ctx - { isochroneData, poiByCategory, suggestions }
   * @returns {Promise<String>} 建议文案
   */
  async generateAdvice(ctx) {
    if (this._llmEnabled()) {
      const prompt = JSON.stringify({
        area: ctx.isochroneData && ctx.isochroneData.area,
        poiCount: Object.values(ctx.poiByCategory || {}).reduce((s, a) => s + (a ? a.length : 0), 0),
        suggestions: (ctx.suggestions || []).map(s => s.message),
      });
      const llmText = await this._llmGenerate(prompt);
      if (llmText) return llmText;
    }
    // 规则引擎兜底
    return this.summarize(ctx.suggestions);
  },
};