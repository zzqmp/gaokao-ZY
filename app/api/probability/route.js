/**
 * 正态分布 CDF
 */
function normalCdf(x, mu, sigma) {
  if (sigma <= 0) return x >= mu ? 1.0 : 0.0;
  // 近似 erf
  const a = (x - mu) / (sigma * Math.SQRT2);
  const sign = a < 0 ? -1 : 1;
  const t = 1 / (1 + 0.3275911 * Math.abs(a));
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a);
  return 0.5 * (1 + sign * y);
}

function calcProbability(userRank, historyRanks, method) {
  if (!historyRanks || historyRanks.length === 0) {
    return { probability: 0, tier: '冲', riskFactors: ['无历史数据，无法估算'] };
  }

  let prob;
  if (method === 'percentile') {
    // 百分位法：历史位次中 >= 用户位次的比例
    const countAbove = historyRanks.filter(r => r >= userRank).length;
    prob = countAbove / historyRanks.length;
  } else if (method === 'conservative') {
    // 保守法
    const minRank = Math.min(...historyRanks);
    const maxRank = Math.max(...historyRanks);
    if (userRank <= minRank) prob = 1.0;
    else if (userRank >= maxRank) prob = 0.0;
    else prob = (maxRank - userRank) / (maxRank - minRank);
  } else {
    // 正态分布法（默认）
    const values = historyRanks.map(r => Number(r));
    const mu = values.reduce((s, v) => s + v, 0) / values.length;
    const sigma = values.length > 1
      ? Math.sqrt(values.reduce((s, v) => s + (v - mu) ** 2, 0) / (values.length - 1))
      : 1.0;
    const sigmaSafe = Math.max(sigma, 1.0);
    prob = 1.0 - normalCdf(userRank, mu, sigmaSafe);
  }

  prob = Math.max(0, Math.min(1, prob));

  let tier;
  if (prob >= 0.7) tier = '保';
  else if (prob >= 0.3) tier = '稳';
  else tier = '冲';

  // 风险因子
  const riskFactors = [];
  if (historyRanks.length < 3) {
    riskFactors.push(`仅 ${historyRanks.length} 年数据，参考价值有限`);
  }
  if (historyRanks.length >= 2) {
    const range = Math.max(...historyRanks) - Math.min(...historyRanks);
    if (range > 5000) riskFactors.push(`历史位次波动较大（跨度 ${range}），需关注趋势`);
    else if (range > 2000) riskFactors.push(`历史位次有一定波动（跨度 ${range}）`);
  }
  if (prob < 0.3) {
    riskFactors.push('同位分换算基于近似，实际录取存在不确定性');
  }

  return { probability: prob, tier, riskFactors };
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const userRankStr = searchParams.get('user_rank');
  const historyRanksStr = searchParams.get('history_ranks');
  const university = searchParams.get('university') || '';
  const major = searchParams.get('major') || '';
  const method = searchParams.get('method') || 'normal_distribution';

  if (!userRankStr) return Response.json({ error: '缺少 user_rank 参数' });
  if (!historyRanksStr) return Response.json({ error: '缺少 history_ranks 参数' });

  const userRank = parseInt(userRankStr, 10);
  if (isNaN(userRank)) return Response.json({ error: '位次格式不正确' });

  const historyRanks = historyRanksStr.split(',')
    .map(s => parseInt(s.trim(), 10))
    .filter(n => !isNaN(n));

  if (historyRanks.length === 0) {
    return Response.json({ error: '历史位次格式不正确，请用逗号分隔' });
  }

  const result = calcProbability(userRank, historyRanks, method);

  return Response.json({
    university,
    major,
    user_rank: userRank,
    history_ranks: historyRanks,
    probability: Math.round(result.probability * 10000) / 10000,
    probability_percent: (result.probability * 100).toFixed(1) + '%',
    tier: result.tier,
    risk_factors: result.riskFactors,
    method,
  });
}
