import { getScoreRankData, getBatchLines, searchUniversity } from '@/lib/data';

function bisectLeft(arr, target) {
  let lo = 0, hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function scoreToRank(records, score) {
  for (const r of records) {
    if (r.score <= score) return { rank: r.cumulativeRank, confidence: 'high' };
  }
  const last = records[records.length - 1];
  return { rank: last.cumulativeRank, confidence: 'medium' };
}

function rankToScore(records, rank) {
  if (!records || records.length === 0) return { score: 0, confidence: 'low' };
  const scores = records.map(r => r.score);
  const ranks = records.map(r => r.cumulativeRank);
  const minRank = ranks[0], maxRank = ranks[ranks.length - 1];
  if (rank < minRank) return { score: scores[0], confidence: 'medium' };
  if (rank > maxRank) return { score: scores[scores.length - 1], confidence: 'medium' };
  const idx = bisectLeft(ranks, rank);
  if (idx >= scores.length) return { score: scores[scores.length - 1], confidence: 'medium' };
  if (ranks[idx] === rank) return { score: scores[idx], confidence: 'high' };
  if (idx === 0) return { score: scores[0], confidence: 'medium' };
  const ratio = (rank - ranks[idx - 1]) / (ranks[idx] - ranks[idx - 1]);
  return { score: Math.round(scores[idx - 1] + (scores[idx] - scores[idx - 1]) * ratio), confidence: 'high' };
}

function normalCdf(x, mu, sigma) {
  if (sigma <= 0) return x >= mu ? 1.0 : 0.0;
  const a = (x - mu) / (sigma * Math.SQRT2);
  const sign = a < 0 ? -1 : 1;
  const t = 1 / (1 + 0.3275911 * Math.abs(a));
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a);
  return 0.5 * (1 + sign * y);
}

function calcProbability(userRank, historyRanks) {
  if (!historyRanks || historyRanks.length === 0) return null;
  const values = historyRanks.map(Number);
  const mu = values.reduce((s, v) => s + v, 0) / values.length;
  const sigma = values.length > 1
    ? Math.sqrt(values.reduce((s, v) => s + (v - mu) ** 2, 0) / (values.length - 1))
    : 1.0;
  const prob = 1.0 - normalCdf(userRank, mu, Math.max(sigma, 1.0));
  const p = Math.max(0, Math.min(1, prob));
  const tier = p >= 0.7 ? '保' : p >= 0.3 ? '稳' : '冲';
  const risks = [];
  if (historyRanks.length < 3) risks.push('仅 ' + historyRanks.length + ' 年数据，参考价值有限');
  const range = Math.max(...historyRanks) - Math.min(...historyRanks);
  if (range > 5000) risks.push('历史位次波动较大（跨度 ' + range + '），需关注趋势');
  else if (range > 2000) risks.push('历史位次有一定波动（跨度 ' + range + '）');
  return { probability: p, tier, riskFactors: risks, historyRanks };
}

function analyzeScoreRank(records, score) {
  if (!records || records.length === 0) return null;
  const exact = records.find(r => r.score === score);
  const nearby = records.filter(r => Math.abs(r.score - score) <= 20);
  if (!exact) {
    const nearest = records.reduce((a, b) => Math.abs(b.score - score) < Math.abs(a.score - score) ? b : a);
    return { found: false, nearestScore: nearest.score, nearestRank: nearest.cumulativeRank };
  }
  const totalInWindow = nearby.reduce((s, r) => s + r.sameScoreNum, 0);
  const above = nearby.filter(r => r.score > score).reduce((s, r) => s + r.sameScoreNum, 0);
  const below = nearby.filter(r => r.score < score).reduce((s, r) => s + r.sameScoreNum, 0);
  const last = records[records.length - 1];
  const totalCandidates = last.cumulativeRank;
  const percentile = totalCandidates > 0 ? Number((1 - exact.cumulativeRank / totalCandidates) * 100).toFixed(1) : null;
  return {
    found: true, score: exact.score, cumulativeRank: exact.cumulativeRank,
    sameScoreNum: exact.sameScoreNum, totalCandidates,
    percentile: percentile ? Number(percentile) : null,
    competitionSummary: {
      windowScoreRange: (score - 20) + '~' + (score + 20),
      totalInWindow, aboveSameScoreTotal: above, belowSameScoreTotal: below,
      avgPerScore: Math.round(totalInWindow / 41),
    },
  };
}

const SYSTEM_PROMPT = [
  '你是一个高考志愿填报助手。你的任务是基于下面提供的真实数据，帮考生理解自己的分数在志愿填报中处于什么位置。',
  '',
  '## 核心原则（必须遵守）',
  '',
  '1. **只基于下面「查询数据」中的内容回答**，不得使用你自己的知识补充任何分数、位次、学校录取分等信息。',
  '2. **每条数据必须标注年份**，如"2024年广东物理类"。',
  '3. **当提供目标大学时，如果查询数据中有该校录取位次，可以分析录取概率**，但必须标注"基于历史数据，不构成录取承诺"。',
  '4. **如果查询数据中没有该校录取信息，必须明确说「暂无该校录取数据」**，不得自己编造。',
  '5. **禁止承诺录取**，不能说"一定能上""稳了""肯定能录取"等。',
  '6. **如果数据不足以回答，就说「目前数据不足以给出这个建议」**。',
  '7. **所有内容仅供用户参考，不能替用户做决定**。',
  '',
  '## 你可以做',
  '',
  '1. **解释位次含义**：在全省排在什么位置，百分比说明竞争力',
  '2. **分析竞争情况**：同分多少人、附近分数段竞争多激烈',
  '3. **批次线对比**：比本科线/特控线高多少分',
  '4. **冲稳保区间建议**：根据位次给出参考区间，解释概念',
  '5. **同位分说明**：今年的分相当于去年多少分，用于参考往年录取数据',
  '6. **如果提供了目标大学且有数据**：说明录取概率、档位（冲/稳/保）、历史录取位次趋势',
  '7. **如果提供了目标大学但无数据**：给出冲稳保区间建议，让考生自行对照该校往年的录取位次',
  '8. **填报策略建议**：如分数段竞争情况，建议拉开梯度等',
  '',
  '## 输出要求',
  '',
  '- 语言要**通俗易懂**，面向高中生和家长',
  '- 用 **加粗** 标出关键数字',
  '- 分段清晰，每段一个小主题',
  '- 末尾固定加：',
  '  ⚠️ 以上分析基于历史数据，仅供参考。最终填报请结合官方招生计划和个人情况综合判断。',
].join('\n');

function buildUserPrompt(data) {
  const q = data.query;
  const lines = ['用户查询：' + q.year + '年' + q.province + q.classify + '，分数 ' + q.score + '分', ''];
  const sr = data.scoreRank;
  if (sr && sr.found) {
    lines.push('【位次信息】');
    lines.push('  分数：' + sr.score + '分');
    lines.push('  全省位次：' + sr.cumulativeRank + '名');
    lines.push('  同分人数：' + sr.sameScoreNum + '人');
    if (sr.totalCandidates) {
      lines.push('  全省总考生数（该选科）：' + sr.totalCandidates + '人');
      lines.push('  你的排名百分比：前' + sr.percentile + '%');
    }
    lines.push('');
  }
  if (data.equivalentScore) {
    const eq = data.equivalentScore;
    lines.push('【同位分换算】');
    lines.push('  ' + eq.source_year + '年' + q.score + '分 -> ' + eq.target_year + '年等效 ' + eq.targetScore + '分');
    lines.push('  置信度：' + eq.confidence);
    lines.push('');
  }
  if (sr && sr.found && sr.competitionSummary) {
    const cs = sr.competitionSummary;
    lines.push('【竞争分析】');
    lines.push('  以' + q.score + '分为中心的' + cs.windowScoreRange + '分区段');
    lines.push('  该区段总人数：约' + cs.totalInWindow + '人');
    lines.push('  比你高20分内人数：约' + cs.aboveSameScoreTotal + '人');
    lines.push('  比你低20分内人数：约' + cs.belowSameScoreTotal + '人');
    lines.push('  平均每分约：' + cs.avgPerScore + '人');
    lines.push('');
  }
  if (data.batchLines && data.batchLines.length > 0) {
    lines.push('【批次线对比】');
    for (const b of data.batchLines) {
      if (b.diff !== null && b.diff !== undefined) {
        const flag = b.diff > 0 ? '超过' : '低于';
        lines.push('  ' + b.batch + '：' + b.score + '分，你' + flag + ' ' + Math.abs(b.diff) + '分');
      }
    }
    lines.push('');
  }
  if (data.cwzReference) {
    const cwz = data.cwzReference;
    lines.push('【冲稳保参考区间】');
    lines.push('  你的位次：' + cwz.yourRank);
    lines.push('  冲（拼搏）：位次 ' + cwz.chongRange);
    lines.push('  稳（稳妥）：位次 ' + cwz.wenRange);
    lines.push('  保（保底）：位次 ' + cwz.baoRange);
    lines.push('  说明：' + cwz.note);
    lines.push('');
  }
  if (data.universityData && data.universityData.records) {
    lines.push('【目标大学录取数据】');
    for (const r of data.universityData.records) {
      lines.push('  大学：' + r.university + '，专业：' + (r.major || '-') + '，年份：' + r.year);
      if (r.min_rank) lines.push('  最低录取位次：' + r.min_rank);
      if (r.score_min) lines.push('  最低录取分数：' + r.score_min);
    }
    lines.push('  数据来源：' + data.universityData.source);
    if (data.probability) {
      const p = data.probability;
      lines.push('【录取概率分析】');
      lines.push('  基于近' + p.historyRanks.length + '年数据估算');
      lines.push('  历史录取位次：' + p.historyRanks.join(', '));
      lines.push('  你的位次：' + sr.cumulativeRank);
      lines.push('  录取概率：' + (p.probability * 100).toFixed(1) + '%');
      lines.push('  档位：' + p.tier);
      lines.push('  风险因素：' + (p.riskFactors.length ? p.riskFactors.join('; ') : '无'));
      lines.push('  (基于历史数据估算，不构成录取承诺)');
    }
    lines.push('');
  } else if (data.universityData === null && data.query.university) {
    lines.push('【目标大学数据】数据库中暂无[' + data.query.university + ']' + (data.query.major || '') + '的录取数据');
    lines.push('');
  }
  lines.push('请用通俗易懂的语言，帮考生理解上述数据在自己填报志愿时意味着什么，给出实用的参考建议。');
  return lines.join('\n');
}

function formatFallbackReply(data) {
  const q = data.query;
  const lines = ['[分析报告] ' + q.year + '年 ' + q.province + ' ' + q.classify + '  ' + q.score + '分', ''];
  const sr = data.scoreRank;
  if (sr && sr.found) {
    lines.push('* 你的分数在全省排第' + sr.cumulativeRank + '名');
    lines.push('* 同分 ' + sr.sameScoreNum + ' 人');
    if (sr.percentile) lines.push('* 你排在全省前 ' + sr.percentile + '%');
    lines.push('');
  }
  if (data.equivalentScore) {
    const eq = data.equivalentScore;
    lines.push('[同位分换算] 相当于 ' + eq.target_year + '年 的 ' + eq.targetScore + '分');
    lines.push('');
  }
  if (sr && sr.found && sr.competitionSummary) {
    const cs = sr.competitionSummary;
    lines.push('[竞争分析] ' + cs.windowScoreRange + '分区段总人数：约' + cs.totalInWindow + '人');
    lines.push('  比你高20分内：约' + cs.aboveSameScoreTotal + '人，比你低20分内：约' + cs.belowSameScoreTotal + '人');
    lines.push('');
  }
  if (data.cwzReference) {
    const cwz = data.cwzReference;
    lines.push('[冲稳保参考区间] 冲：' + cwz.chongRange + '，稳：' + cwz.wenRange + '，保：' + cwz.baoRange);
    lines.push('');
  }
  lines.push('[填报建议]');
  lines.push('  - 建议采用冲-稳-保梯度策略');
  lines.push('  - 冲：选位次比你高15%以内的学校');
  lines.push('  - 稳：选位次与你相当或略低的学校');
  lines.push('  - 保：选位次比你低30%以上的学校');
  lines.push('');
  lines.push('以上分析基于历史数据，仅供参考。最终填报请结合官方招生计划和个人情况综合判断。');
  return lines.join('\n');
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const province = searchParams.get('province');
  const classify = searchParams.get('classify');
  const scoreStr = searchParams.get('score');
  const yearStr = searchParams.get('year');
  const university = searchParams.get('university') || null;
  const major = searchParams.get('major') || null;

  if (!province) return Response.json({ error: '请选择省份', ok: false });
  if (!classify) return Response.json({ error: '请选择选科', ok: false });
  if (!scoreStr) return Response.json({ error: '请输入分数', ok: false });

  const score = parseInt(scoreStr, 10);
  if (isNaN(score)) return Response.json({ error: '分数格式不正确', ok: false });

  const queryYear = parseInt(yearStr, 10) || 2024;
  const targetYear = 2025;

  const records = await getScoreRankData(province, queryYear, classify);
  const sr = analyzeScoreRank(records, score);

  if (!sr || !sr.found) {
    const nearestMsg = sr?.nearestScore
      ? '未精确命中' + score + '分。最近' + sr.nearestScore + '分对应位次' + sr.nearestRank
      : queryYear + '年' + province + classify + '暂无一分一段数据';
    return Response.json({ ok: true, reply: nearestMsg, ai_enabled: false });
  }

  const rank = sr.cumulativeRank;

  let eq = null;
  if (targetYear !== queryYear) {
    const tgtRecords = await getScoreRankData(province, String(targetYear), classify);
    if (tgtRecords && tgtRecords.length > 0) {
      const result = rankToScore(tgtRecords, rank);
      eq = { source_year: queryYear, target_year: targetYear, sourceScore: score, targetScore: result.score, sourceRank: rank, confidence: result.confidence };
    }
  }

  const cwzReference = {
    yourRank: rank,
    chongRange: Math.max(1, Math.round(rank * 0.85)) + '-' + rank,
    wenRange: rank + '-' + Math.round(rank * 1.3),
    baoRange: Math.round(rank * 1.3) + '-' + Math.round(rank * 2.0),
    note: '冲：位次略高于你，有希望但不确定；稳：位次与你相当，概率较大；保：位次明显低于你，作为保底',
  };

  let batchLines = [];
  try {
    const allBatchLines = await getBatchLines();
    batchLines = allBatchLines
      .filter(b => b.province === province && String(b.year) === String(queryYear) && b.student_type === classify)
      .map(b => ({ batch: b.batch, score: b.score, rank: b.rank, diff: b.score !== null ? score - b.score : null }));
  } catch (e) {}

  let universityData = null;
  let probability = null;
  if (university) {
    try {
      const matches = await searchUniversity(province, university, major);
      if (matches.length > 0) {
        universityData = { records: matches.slice(0, 20), source: 'database' };
        const historyRanks = matches.filter(r => r.min_rank).map(r => r.min_rank);
        if (historyRanks.length > 0) probability = calcProbability(rank, historyRanks);
      }
    } catch (e) {}
  }

  const data = {
    query: { province, classify, score, year: queryYear, university, major },
    scoreRank: sr, equivalentScore: eq, cwzReference, batchLines, universityData, probability,
  };

  const apiKey = process.env.DEEPSEEK_API_KEY;
  const apiModel = process.env.DEEPSEEK_MODEL || 'deepseek-chat';

  if (apiKey && apiKey !== 'sk-your-key-here') {
    const userPrompt = buildUserPrompt(data);
    try {
      const resp = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: apiModel,
          messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: userPrompt }],
          temperature: 0.3, max_tokens: 1500,
        }),
        signal: AbortSignal.timeout(30000),
      });
      if (resp.ok) {
        const json = await resp.json();
        const reply = json.choices?.[0]?.message?.content;
        if (reply) return Response.json({ ok: true, reply, ai_enabled: true });
      }
    } catch (e) {}
  }

  const fallbackReply = formatFallbackReply(data);
  return Response.json({ ok: true, reply: fallbackReply, ai_enabled: false });
}
