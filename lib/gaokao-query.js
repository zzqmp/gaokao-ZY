/**
 * 高考志愿查询核心逻辑
 * 从 api/chat/route.js 提取的共享模块，供 API 路由和微信 Handler 共用
 */

import { getScoreRankData, getBatchLines, getProvinces, getValidClassifies, getGaokaoMode, getScoreRankIndex, searchUniversity } from '@/lib/data';

// ============================================================
// 自然语言解析
// ============================================================

const CLASSIFY_ALIASES = {
  '物理': ['物理', '理科', '综合'],
  '历史': ['历史', '文科'],
  '理科': ['理科', '物理', '综合'],
  '文科': ['文科', '历史'],
  '综合': ['综合'],
};

/**
 * 从单条文本中提取结构化信息
 */
function parseSingle(text) {
  const result = {};

  // 分数
  const scoreMatch = text.match(/(\d{3})\s*分/);
  if (scoreMatch) result.score = parseInt(scoreMatch[1]);

  // 年份
  const yearMatch = text.match(/(20\d{2})\s*年/);
  if (yearMatch) result.year = yearMatch[1];

  // 省份
  const aliases = {
    '北京|京': '北京', '上海|沪|魔都': '上海', '天津|津': '天津', '重庆|渝': '重庆',
    '广东|粤': '广东', '福建|闽': '福建', '湖南|湘': '湖南', '湖北|鄂': '湖北',
    '河南|豫': '河南', '河北|冀': '河北', '山东|鲁': '山东', '江苏|苏': '江苏',
    '浙江|浙': '浙江', '安徽|皖': '安徽', '江西|赣': '江西', '四川|川|蜀': '四川',
    '陕西|陕|秦': '陕西', '甘肃|甘': '甘肃', '云南|滇': '云南', '贵州|黔': '贵州',
    '山西|晋': '山西', '辽宁|辽': '辽宁', '吉林|吉': '吉林', '黑龙江|黑': '黑龙江',
    '海南|琼': '海南', '广西|桂': '广西', '内蒙古|蒙': '内蒙古',
    '西藏|藏': '西藏', '新疆|新': '新疆', '宁夏|宁': '宁夏', '青海|青': '青海',
  };
  for (const [pattern, pname] of Object.entries(aliases)) {
    if (new RegExp(pattern).test(text)) { result.province = pname; break; }
  }

  // 选科
  const classifyMatch = text.match(/(物理|历史|文科|理科|综合)/);
  if (classifyMatch) result.classify = classifyMatch[1];

  // 城市偏好
  const cityPatterns = [
    /去\s*(北京|上海|广州|深圳|杭州|南京|成都|武汉|西安|重庆|天津|长沙|苏州|郑州|厦门|福州|合肥|济南|青岛|沈阳|大连|昆明|贵阳|南宁|海口|兰州|哈尔滨|长春|南昌|太原|石家庄|呼和浩特|乌鲁木齐|银川|西宁|拉萨)/,
    /想.*(?:去|到|在)\s*(北京|上海|广州|深圳|杭州|南京|成都|武汉|西安|重庆|天津|长沙|苏州|郑州|厦门|福州|合肥|济南|青岛|沈阳|大连|昆明|贵阳|南宁|海口|兰州|哈尔滨|长春|南昌|太原|石家庄|呼和浩特|乌鲁木齐|银川|西宁|拉萨)/,
  ];
  for (const ptn of cityPatterns) {
    const m = text.match(ptn);
    if (m) { result.city = m[1]; break; }
  }

  // 大学
  if (!result.university) {
    const uniPatterns = [
      /(?:查|搜|看|找|问|了解|咨询|关注)(?:\s*一下|\s*一?看)?\s*(.+?(?:大学|学院))/,
      /想(?:去|上|读|考|报)\s*(.+?(?:大学|学院))/,
      /(.+?(?:大学|学院))/,
    ];
    for (const ptn of uniPatterns) {
      const m = text.match(ptn);
      if (m) {
        const name = m[1].trim();
        if (name.replace(/(?:大学|学院)/, '').length >= 2) {
          result.university = name;
          break;
        }
      }
    }
  }

  // 专业
  const majorPatterns = [
    /想(?:学|读|报|选)\s*(.+?)(?:专业|类)/,
    /(?:学|读|报|选)\s*(.+?)(?:专业|类)/,
  ];
  for (const ptn of majorPatterns) {
    const m = text.match(ptn);
    if (m) { result.major = m[1]; break; }
  }

  return result;
}

/**
 * 多文本解析：最新消息优先，历史仅补充缺失字段
 */
export async function parseInfo(texts) {
  const info = { year: null, province: null, classify: null, score: null, university: null, major: null, city: null };

  for (let i = texts.length - 1; i >= 0; i--) {
    const parsed = parseSingle(texts[i]);
    for (const key of Object.keys(info)) {
      if (info[key] === null && parsed[key] !== undefined) {
        info[key] = parsed[key];
      }
    }
  }

  return info;
}

// ============================================================
// 城市→省份
// ============================================================

const CITY_PROVINCE_MAP = {
  '北京': '北京', '上海': '上海', '天津': '天津', '重庆': '重庆',
  '广州': '广东', '深圳': '广东', '南京': '江苏', '杭州': '浙江',
  '成都': '四川', '武汉': '湖北', '西安': '陕西', '长沙': '湖南',
  '苏州': '江苏', '郑州': '河南', '厦门': '福建', '福州': '福建',
  '合肥': '安徽', '济南': '山东', '青岛': '山东', '沈阳': '辽宁',
  '大连': '辽宁', '昆明': '云南', '贵阳': '贵州', '南宁': '广西',
  '海口': '海南', '兰州': '甘肃', '哈尔滨': '黑龙江', '长春': '吉林',
  '南昌': '江西', '太原': '山西', '石家庄': '河北', '呼和浩特': '内蒙古',
  '乌鲁木齐': '新疆', '银川': '宁夏', '西宁': '青海', '拉萨': '西藏',
};

export function cityToProvince(city) {
  return CITY_PROVINCE_MAP[city] || null;
}

// ============================================================
// 选科名称兼容
// ============================================================

async function getClassifyForYear(province, year, classify) {
  const index = await getScoreRankIndex();
  const provinceData = index[province];
  if (!provinceData) return classify;
  const yearClassifies = provinceData[year];
  if (!yearClassifies) return classify;
  if (yearClassifies.includes(classify)) return classify;
  const aliases = CLASSIFY_ALIASES[classify] || [classify];
  for (const a of aliases) {
    if (yearClassifies.includes(a)) return a;
  }
  return classify;
}

// ============================================================
// 获取可用年份
// ============================================================

export async function getAvailableYears(province, classify) {
  try {
    const index = await getScoreRankIndex();
    const provinceData = index[province];
    if (!provinceData) return [];
    const aliases = CLASSIFY_ALIASES[classify] || [classify];
    const years = [];
    for (const [year, classifies] of Object.entries(provinceData)) {
      if (aliases.some(a => classifies.includes(a))) years.push(year);
    }
    return years.sort((a, b) => parseInt(b) - parseInt(a));
  } catch (_) {
    return [];
  }
}

// ============================================================
// 多年度数据查询
// ============================================================

export async function queryMultiYear(info, years) {
  const result = { byYear: {}, batchLinesByYear: {} };

  for (const year of years) {
    const yd = { year };
    const actualClassify = await getClassifyForYear(info.province, year, info.classify);
    const records = await getScoreRankData(info.province, year, actualClassify);
    if (records && records.length > 0 && info.score) {
      const exact = records.find(r => r.score === info.score);
      if (exact) {
        yd.rank = exact.cumulativeRank;
        yd.sameScoreNum = exact.sameScoreNum;
        const last = records[records.length - 1];
        yd.totalCandidates = last.cumulativeRank;
        yd.percentile = last.cumulativeRank > 0
          ? Number(((1 - exact.cumulativeRank / last.cumulativeRank) * 100).toFixed(1))
          : null;

        // 竞争窗口（±20分）
        const nearby = records.filter(r => Math.abs(r.score - info.score) <= 20);
        yd.competition = {
          totalInWindow: nearby.reduce((s, r) => s + r.sameScoreNum, 0),
          aboveSum: nearby.filter(r => r.score > info.score).reduce((s, r) => s + r.sameScoreNum, 0),
          belowSum: nearby.filter(r => r.score < info.score).reduce((s, r) => s + r.sameScoreNum, 0),
        };
      } else {
        const nearest = records.reduce((a, b) => Math.abs(b.score - info.score) < Math.abs(a.score - info.score) ? b : a);
        yd.nearest = { score: nearest.score, rank: nearest.cumulativeRank };
      }
    }
    result.byYear[year] = yd;
  }

  // 批次线
  try {
    const allBatchLines = await getBatchLines();
    for (const year of years) {
      const actualClassify = await getClassifyForYear(info.province, year, info.classify);
      const lines = allBatchLines.filter(b =>
        b.province === info.province && String(b.year) === year && b.student_type === actualClassify
      );
      if (lines.length > 0) {
        result.batchLinesByYear[year] = lines.map(b => ({
          batch: b.batch, score: b.score,
          diff: info.score !== null ? info.score - b.score : null,
        }));
      }
    }
  } catch (_) {}

  // 大学录取数据
  if (info.university && info.province) {
    try {
      const matches = await searchUniversity(info.province, info.university, info.major);
      result.universityData = matches.length > 0 ? { records: matches.slice(0, 20) } : null;
    } catch (_) {
      result.universityData = null;
    }
  }

  return result;
}

// ============================================================
// 确认缺失信息
// ============================================================

export function buildClarifyingQuestion(info) {
  if (!info.score && !info.province) {
    return '请告诉我你的分数和省份，我来帮你分析。例如：\n"我考了600分，广东物理类"';
  }
  if (!info.score) return '请问你考了多少分？';
  if (!info.province) return '请问你是哪个省份的考生？';
  if (!info.classify) {
    const mode = info.province ? getGaokaoMode(info.province, '2025') : null;
    if (mode === 'old') return '请问你是文科还是理科？';
    if (mode === '3+3') return ''; // 3+3 模式无需选科
    return '请问你是物理类还是历史类？';
  }
  return null;
}

// ============================================================
// 正态分布 CDF
// ============================================================

function normalCdf(x, mu, sigma) {
  if (sigma <= 0) return x >= mu ? 1.0 : 0.0;
  const a = (x - mu) / (sigma * Math.SQRT2);
  const sign = a < 0 ? -1 : 1;
  const t = 1 / (1 + 0.3275911 * Math.abs(a));
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a);
  return 0.5 * (1 + sign * y);
}

function calcProbability(userRank, historyRanks) {
  if (!historyRanks || historyRanks.length === 0 || !userRank) return null;
  const values = historyRanks.map(Number);
  const mu = values.reduce((s, v) => s + v, 0) / values.length;
  const sigma = values.length > 1
    ? Math.sqrt(values.reduce((s, v) => s + (v - mu) ** 2, 0) / (values.length - 1))
    : 1.0;
  const prob = Math.max(0, Math.min(1, 1.0 - normalCdf(userRank, mu, Math.max(sigma, 1.0))));
  return {
    probability: prob,
    tier: prob >= 0.7 ? '保' : prob >= 0.3 ? '稳' : '冲',
    historyCount: values.length,
  };
}

// ============================================================
// 构建回复文本
// ============================================================

/**
 * 构建用于 AI 的 prompt（供 DeepSeek 调用使用）
 */
export async function buildAiPrompt(info, data, years) {
  const lines = [];
  lines.push('## 用户查询');
  lines.push(info.text);
  lines.push('');

  const primaryYear = years[0];
  const primaryData = data.byYear[primaryYear];

  lines.push('## 本地数据（均为历史年份，非用户考试年份）');
  const hasRankData = years.some(y => data.byYear[y]?.rank);
  if (hasRankData) {
    lines.push(`查询条件：${info.province}　${info.classify}　${info.score}分`);
    lines.push(`数据年份：${years.join('、')}年（历年）`);
    lines.push('');

    lines.push('**近年位次对比**');
    lines.push('| 年份 | 位次 | 同分人数 | 总考生数 | 排名百分比 |');
    lines.push('|------|------|----------|----------|------------|');
    for (const year of years) {
      const yd = data.byYear[year];
      if (yd?.rank) {
        lines.push(`| ${year}年 | ${yd.rank} | ${yd.sameScoreNum} | ${yd.totalCandidates || '-'} | ${yd.percentile ? '前'+yd.percentile+'%' : '-'} |`);
      } else if (yd?.nearest) {
        lines.push(`| ${year}年 | 未精确命中，最近${yd.nearest.score}分→位次${yd.nearest.rank} | - | - | - |`);
      } else {
        lines.push(`| ${year}年 | 暂无数据 | - | - | - |`);
      }
    }
    lines.push('');

    const namingChanges = {};
    for (const year of years) {
      const actual = await getClassifyForYear(info.province, year, info.classify);
      if (actual !== info.classify) namingChanges[year] = actual;
    }
    if (Object.keys(namingChanges).length > 0) {
      const reformYears = Object.keys(namingChanges).sort();
      const oldNames = [...new Set(Object.values(namingChanges))];
      lines.push(`注：${reformYears.join('、')}年为老高考（${oldNames.join('/')}），${primaryYear}年起已改为新高考（${info.classify}类）。`);
      lines.push('');
    }

    if (primaryData?.competition) {
      const c = primaryData.competition;
      lines.push(`**${primaryYear}年竞争分析**（以${info.score}分为中心±20分）`);
      lines.push(`- 该区段总人数：约${c.totalInWindow}人`);
      lines.push(`- 高于你的分数段人数：约${c.aboveSum}人`);
      lines.push(`- 低于你的分数段人数：约${c.belowSum}人`);
      lines.push('');
    }

    if (data.batchLinesByYear[primaryYear]?.length > 0) {
      lines.push(`**${primaryYear}年批次线对比**`);
      for (const b of data.batchLinesByYear[primaryYear]) {
        if (b.diff !== null) {
          const flag = b.diff > 0 ? '超过' : '低于';
          lines.push(`- ${b.batch}：${b.score}分，你${flag} ${Math.abs(b.diff)}分`);
        }
      }
      lines.push('');
    }

    if (primaryData?.rank) {
      const rank = primaryData.rank;
      lines.push(`**${primaryYear}年冲稳保参考区间**`);
      lines.push(`- 冲：位次 ${Math.max(1, Math.round(rank * 0.85))}～${rank}`);
      lines.push(`- 稳：位次 ${rank}～${Math.round(rank * 1.3)}`);
      lines.push(`- 保：位次 ${Math.round(rank * 1.3)}～${Math.round(rank * 2.0)}`);
      lines.push('');
    }
  } else {
    lines.push(`${info.province} ${info.classify}，${info.score}分`);
    lines.push('本地暂无该组合的一分一段数据。');
    lines.push('');
  }

  // 大学录取数据
  if (data.universityData?.records?.length > 0) {
    lines.push('**目标大学近年录取数据**');
    for (const r of data.universityData.records) {
      lines.push(`- ${r.university}${r.major ? '·'+r.major : ''} ${r.year}年 最低位次${r.min_rank || '无'} 最低分${r.score_min || '无'}`);
    }
    const byUni = {};
    for (const r of data.universityData.records) {
      if (!byUni[r.university]) byUni[r.university] = [];
      if (r.min_rank) byUni[r.university].push(r.min_rank);
    }
    for (const [uni, ranks] of Object.entries(byUni)) {
      if (ranks.length > 0 && primaryData?.rank) {
        const p = calcProbability(primaryData.rank, ranks);
        if (p) lines.push(`- ${uni}录取概率：${(p.probability * 100).toFixed(1)}%（${p.tier}，基于${p.historyCount}年数据）`);
      }
    }
    lines.push('');
  } else if (data.universityData === null && info.university) {
    lines.push(`- 目标大学「${info.university}」暂无本地录取数据`);
    lines.push('');
  }

  lines.push('以上均为历史年份数据，请帮考生理解分数在志愿填报中的位置。优先使用本地数据。注意：禁止说"今年""你的年份""当年"。');
  return lines.join('\n');
}

/**
 * 构建纯文本的降级回复（无 AI 时使用，也用于微信回复）
 * 返回 { text, shortText }，shortText 用于微信 5 秒内快速回复
 */
export function buildFallbackReply(info, data, years) {
  const lines = [];
  const primaryYear = years[0];
  const primaryData = data.byYear[primaryYear];

  if (primaryData?.rank) {
    lines.push(`📊 ${info.province} ${info.classify} · ${info.score}分`);
    lines.push('');

    // 近年位次
    lines.push('📈 近年位次：');
    for (const year of years) {
      const yd = data.byYear[year];
      if (yd?.rank) {
        lines.push(`  ${year}年：${yd.rank}名（同分${yd.sameScoreNum}人${yd.percentile ? '，前'+yd.percentile+'%' : ''}）`);
      } else if (yd?.nearest) {
        lines.push(`  ${year}年：未命中，最近${yd.nearest.score}分→${yd.nearest.rank}名`);
      } else {
        lines.push(`  ${year}年：暂无数据`);
      }
    }
    lines.push('');

    // 批次线
    if (data.batchLinesByYear[primaryYear]?.length > 0) {
      lines.push('📋 批次对比：');
      for (const b of data.batchLinesByYear[primaryYear]) {
        if (b.diff !== null) {
          lines.push(`  ${b.batch}${b.diff > 0 ? ' ✅超' : ' ❌差'}${Math.abs(b.diff)}分（${b.score}分）`);
        }
      }
      lines.push('');
    }

    // 冲稳保
    const rank = primaryData.rank;
    lines.push('🎯 冲稳保建议：');
    lines.push(`  冲刺：位次 ${Math.max(1, Math.round(rank * 0.85))}～${rank}`);
    lines.push(`  稳妥：位次 ${rank}～${Math.round(rank * 1.3)}`);
    lines.push(`  保底：位次 ${Math.round(rank * 1.3)}～${Math.round(rank * 2.0)}`);
    lines.push('');

    // 竞争分析
    if (primaryData?.competition) {
      const c = primaryData.competition;
      lines.push(`👥 竞争（±20分）：${c.totalInWindow}人 · 高于你${c.aboveSum}人`);
      lines.push('');
    }

    // 大学数据
    if (data.universityData?.records?.length > 0) {
      const uniInfo = {};
      for (const r of data.universityData.records) {
        if (!uniInfo[r.university]) uniInfo[r.university] = [];
        uniInfo[r.university].push(`${r.year}年最低${r.min_rank ? r.min_rank+'名' : (r.score_min ? r.score_min+'分' : '无')}`);
      }
      for (const [uni, infoArr] of Object.entries(uniInfo)) {
        lines.push(`🏫 ${uni}：${infoArr.join(' / ')}`);
      }
      lines.push('');
    }

    lines.push('⚠️ 基于历史数据，仅供参考。最终填报请结合官方招生计划和个人情况综合判断。');
  } else {
    if (info.score) {
      lines.push(`${info.province || ''} ${info.classify || ''} ${info.score}分`);
      lines.push('暂无该组合的完整位次数据。');
    } else {
      lines.push('请提供你的分数、省份和选科信息，我来帮你分析。');
    }
  }

  const fullText = lines.join('\n');
  // 短文本用于微信快速回复（前200字符摘要）
  const shortText = primaryData?.rank
    ? `📊 ${info.province}${info.classify}${info.score}分 → 位次${primaryData.rank}名${primaryData.percentile ? '（前'+primaryData.percentile+'%）' : ''}\n📈 ${years[0]}年同分${primaryData.sameScoreNum}人\n回复「详细」获取完整分析`
    : fullText.length > 300 ? fullText.slice(0, 300) + '...\n回复「详细」获取完整分析' : fullText;

  return { fullText, shortText };
}

/**
 * 核心查询 + 回复生成
 * 供 WeChat/API 共用
 */
export async function queryAndReply(text, history = []) {
  if (!text || !text.trim()) {
    return { reply: '请说说你的高考情况，我来帮你分析。', complete: false, info: null, years: [] };
  }

  const allTexts = [...history.filter(m => m.role === 'user').map(m => m.content), text];
  const info = await parseInfo(allTexts);
  info.text = text;

  // 检查缺失信息
  const clarifying = buildClarifyingQuestion(info);
  if (clarifying !== null) {
    if (clarifying === '') {
      info.classify = '综合';
    } else {
      return { reply: clarifying, complete: false, info, years: [] };
    }
  }

  // 自动推断选科
  if (!info.classify) {
    const classifies = getValidClassifies(info.province, '2025');
    if (classifies && classifies.length > 0) {
      info.classify = classifies[0];
    }
  }

  // 校验选科
  if (info.classify && info.province) {
    const validClassifies = getValidClassifies(info.province, '2025');
    if (validClassifies && validClassifies.length > 0 && !validClassifies.includes(info.classify)) {
      const mode = getGaokaoMode(info.province, '2025');
      const validStr = validClassifies.join('」或「');
      let hint;
      if (mode === '3+3') {
        hint = `${info.province}是3+3新高考，只设「${validStr}」类，没有「${info.classify}」类。请重新输入正确的选科。`;
      } else if (mode === '3+1+2') {
        hint = `${info.province}是3+1+2新高考，选科为「${validStr}」类，请重新输入。`;
      } else {
        hint = `${info.province}是老高考，选科为「${validStr}」类，请重新输入。`;
      }
      return { reply: hint, complete: false, info, years: [] };
    }
  }

  // 城市→省份
  if (!info.province && info.city) {
    info.province = cityToProvince(info.city);
  }

  if (!info.province || !info.score || !info.classify) {
    return { reply: '请提供你的分数、省份和选科信息。', complete: false, info, years: [] };
  }

  // 确定查询年份
  let availableYears = await getAvailableYears(info.province, info.classify);
  if (availableYears.length === 0) {
    return { reply: `抱歉，${info.province}${info.classify}暂无可用的一分一段数据。`, complete: false, info, years: [] };
  }

  let queryYears;
  if (info.year) {
    if (availableYears.includes(info.year)) {
      const idx = availableYears.indexOf(info.year);
      queryYears = availableYears.slice(Math.max(0, idx - 2), idx + 1);
    } else {
      queryYears = availableYears.slice(0, 3);
    }
  } else {
    queryYears = availableYears.slice(0, 3);
  }
  info.year = queryYears[0];

  const data = await queryMultiYear(info, queryYears);
  const reply = buildFallbackReply(info, data, queryYears);

  return {
    reply: reply.fullText,
    shortReply: reply.shortText,
    complete: true,
    info,
    years: queryYears,
    data,
  };
}
