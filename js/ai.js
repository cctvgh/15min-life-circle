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

  /**
   * 让 LLM 参与核心分析：基于完整体检数据生成"综合诊断 + 分区改进方案"
   * @param {Object} ctx - { name, coord, area, poiByCategory, score, gaps, aiSuggestions }
   * @returns {Promise<String>}
   */
  async generateComprehensive(ctx) {
    if (this._llmEnabled()) {
      const sys = '你是资深社区生活圈规划顾问，请基于给定数据输出简洁、可执行的综合诊断与分区改进方案，语气专业简洁。';
      const text = await this._llmGenerate(this._buildComprehensivePrompt(ctx), sys);
      if (text) return text;
    }
    return this.summarize(ctx.aiSuggestions || []);
  },

  /**
   * 多轮对话（工具调用闭环用）
   */
  async _llmChat(messages, system) {
    const cfg = window.AI_CONFIG;
    if (!this._llmEnabled()) return null;
    try {
      const msgs = system ? [{ role: 'system', content: system }, ...messages] : messages;
      const res = await fetch(cfg.baseUrl || 'https://open.bigmodel.cn/api/paas/v4/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.apiKey },
        body: JSON.stringify({ model: cfg.model || 'glm-4-flash', messages: msgs, temperature: 0.5, max_tokens: 900 }),
      });
      if (!res.ok) { console.warn('[AI] LLM返回', res.status); return null; }
      const data = await res.json();
      const text = data.choices && data.choices[0] && data.choices[0].message
        ? data.choices[0].message.content : null;
      return text ? String(text).trim() : null;
    } catch (e) { console.warn('[AI] LLM调用失败', e.message); return null; }
  },

  /**
   * LLM 承担核心分析（工具调用闭环）
   * round1: LLM 从候选点选出需补设施 → 代码 simulate 验证评分增益
   * round2: 把验证结果回填，LLM 权衡输出最终决策(优先级/方案/推荐)
   * @param {Object} ctx - { name, isochroneData, poiByCategory, score, gaps, aiSuggestions }
   * @returns {Promise<Object>} 决策对象
   */
  async analyzeWithTools(ctx) {
    const sys = '你是社区生活圈规划决策专家。只能依据提供的已验证数据做决策，不得编造数值或坐标。';
    const ctxText = this._buildToolContext(ctx);

    // round1：让 LLM 从候选点提出改进候选
    const round1 = await this._llmChat([
      { role: 'user', content: '以下为社区体检数据。请从"AI候选点"中选出应新增的设施并给出理由，输出JSON：{"facilities":[{"key":"医院","index":0,"reason":"..."}]}，index为候选点序号，不要自行编造坐标。\n\n' + ctxText },
    ], sys);

    // 候选清单（LLM 失败则回退全部 AI 候选）
    const cands = this._parseCandidates(round1, ctx);

    // 工具验证：对每个候选用评分函数 simulate 计算真实增益
    const verified = cands.map(c => {
      const loc = c.location;
      const sim = loc ? Planning.simulate(ctx.isochroneData || {}, ctx.poiByCategory || {}, c.key, loc) : null;
      return {
        ...c,
        gain: sim ? sim.improvement.total : 0,
        afterTotal: sim ? sim.after.total : (ctx.score ? ctx.score.total : 0),
        beforeTotal: ctx.score ? ctx.score.total : 0,
      };
    }).sort((a, b) => b.gain - a.gain);

    // round2：回填验证结果，让 LLM 权衡输出最终决策
    const evidence = verified.map(v => `增${v.name}@(${v.location.lng.toFixed(4)},${v.location.lat.toFixed(4)})：评分增益+${v.gain}`).join('；') || '无已验证方案';
    const round2 = await this._llmChat([
      { role: 'user', content: ctxText },
      { role: 'assistant', content: round1 || '[]' },
      { role: 'user', content: '系统已对上述候选方案用真实评分逐项验证，结果如下：\n' + evidence + '\n请基于验证结果输出最终决策JSON：{"priority":[{"key":"医院","gain":11,"reason":"..."}],"recommendation":"..."}' },
    ], sys);

    return this._buildDecision(verified, round2, ctx);
  },

  _buildToolContext(ctx) {
    const cats = (typeof POI_CATEGORIES !== 'undefined') ? POI_CATEGORIES : [];
    const parts = cats.map(c => {
      const n = (ctx.poiByCategory && ctx.poiByCategory[c.key]) ? ctx.poiByCategory[c.key].length : 0;
      return `${c.name}${n}（阈值${c.min}，${n >= c.min ? '达标' : '不足'}）`;
    }).join('、');
    const cand = (ctx.aiSuggestions || []).map((s, i) => `#${i} 增${s.category ? s.category.name : '设施'}于(${s.location.lng.toFixed(4)},${s.location.lat.toFixed(4)}) 预期+${s.scoreImprovement}`).join('\n') || '无';
    return `社区：${ctx.name || ''}\n设施：${parts || '无'}\n服务盲区：${ctx.gaps || 0} 处\nAI候选点：\n${cand}`;
  },

  // 解析 LLM 候选 → 回退为 AI 全部候选
  _parseCandidates(text, ctx) {
    const list = [];
    const push = (key, index, reason, name) => {
      const sug = (ctx.aiSuggestions || [])[index];
      const k = this._mapKey(key);
      if (sug && k) list.push({ key: k, name: name || key, index, reason: reason || '', location: sug.location });
    };
    if (text) {
      try {
        const obj = JSON.parse(this._extractJson(text));
        if (obj && Array.isArray(obj.facilities)) {
          obj.facilities.forEach(f => push(f.key || f.facility, Number(f.index) || 0, f.reason || '', f.name));
        }
      } catch (e) { /* 解析失败走回退 */ }
    }
    if (list.length === 0) {
      (ctx.aiSuggestions || []).forEach((s, i) => {
        const k = s.category ? s.category.key : '';
        if (k) list.push({ key: k, name: s.category.name, index: i, reason: '', location: s.location });
      });
    }
    return list;
  },

  _mapKey(name) {
    const cats = (typeof POI_CATEGORIES !== 'undefined') ? POI_CATEGORIES : [];
    const hit = cats.find(c => c.key === name || c.name === name || (c.keywords || []).indexOf(name) >= 0);
    return hit ? hit.key : (typeof name === 'string' ? name : null);
  },

  _extractJson(text) {
    const m = String(text).match(/\{[\s\S]*\}/);
    return m ? m[0] : '{}';
  },

  _buildDecision(verified, round2, ctx) {
    const priority = [];
    if (round2) {
      try {
        const obj = JSON.parse(this._extractJson(round2));
        if (obj && Array.isArray(obj.priority)) {
          obj.priority.forEach(p => priority.push({
            key: this._mapKey(p.key || p.facility),
            name: p.facility || p.key || '',
            score: (p.score != null ? p.score : p.gain) != null ? (p.score != null ? p.score : p.gain) : null, reason: p.reason || '',
          }));
        }
      } catch (e) { /* 解析失败用 verified */ }
    }
    if (priority.length === 0) {
      verified.slice(0, 5).forEach(v => priority.push({ key: v.key, name: v.name, score: v.gain, reason: v.reason || '' }));
    }
    return {
      priority,
      verified,
      recommendation: round2 && (round2.match(/recommendation[":\s]+([^"]+)/) || [])[1] || '',
      evidence: verified.map(v => `${v.name}@(${v.location.lng.toFixed(4)},${v.location.lat.toFixed(4)}) 增益+${v.gain}`).join('；'),
    };
  },

  _buildComprehensivePrompt(ctx) {
    const poiText = Object.entries(ctx.poiByCategory || {})
      .map(([k, arr]) => `${k}${(arr || []).length}`).join('、') || '无';
    const bd = (ctx.score && ctx.score.breakdown) || {};
    const sug = (ctx.aiSuggestions || []).map(s => s.message).join('；') || '无';
    const coord = ctx.coord ? ctx.coord.map(v => Number(v).toFixed(4)).join(', ') : '';
    return `请对以下 15 分钟生活圈体检数据输出"综合诊断 + 分区改进方案"：
社区：${ctx.name || ''}（坐标 ${coord}）
15 分钟步行可达面积：${ctx.area ? ctx.area + ' km²' : '未知'}
9 类设施数量：${poiText}
综合评分：${ctx.score ? ctx.score.total : '?'}分，四维评分：配套完整度${bd.completeness ?? '?'}、就近便利度${bd.proximity ?? '?'}、等时圈覆盖${bd.coverage ?? '?'}、类别多样性${bd.diversity ?? '?'}
服务盲区：${ctx.gaps ?? '?'} 处
AI 寻优建议：${sug}
请输出：
1) 社区现状综合诊断（200 字内，点出核心短板与优势）；
2) 分区改进方案（按设施缺口优先级逐条列出，每条含推荐落点与预期效果）。`;
  },
};