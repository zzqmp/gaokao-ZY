/**
 * 同位分换算 + 录取概率引擎 (JS版)
 */

import { getScoreRankData } from './data-loader';

// ============================================================
// 同位分换算
// ============================================================

export function equivalentScore(sourceYear, targetYear, sourceScore, province, classify) {
  const srcData = getScoreRankData(province, sourceYear, classify);
  const tgtData = getScoreRankData(province, targetYear, classify);
  if (!srcData || !tgtData) {
    return { sourceYear, targetYear, sourceScore, targetScore: sourceScore, sourceRank: 0, confidence: 'low' };
  }

  // Step 1: sourceScore → rank
  let sourceRank = 0;
  for (const r of srcData) {
    if (r.score <= sourceScore) { sourceRank = r.cumulativeRank; break; }
  }
  if (!sourceRank) sourceRank = srcData[srcData.length - 1]?.cumulativeRank || 0;

  // Step 2: rank → targetScore
  let targetScore = 0;
  let confidence = 'high';
  const minRank = tgtData[0]?.cumulativeRank || 0;
  const maxRank = tgtData[tgtData.length - 1]?.cumulativeRank || 0;

  if (sourceRank < minRank) {
    targetScore = tgtData[0]?.score || sourceScore;
    confidence = 'medium';
  } else if (sourceRank > maxRank) {
    targetScore = tgtData[tgtData.length - 1]?.score || sourceScore;
    confidence = 'medium';
  } else {
    // 二分查找：找第一个 cumulativeRank >= sourceRank 的位置
    // 数据按 score 降序排列，cumulativeRank 递增
    let lo = 0, hi = tgtData.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (tgtData[mid].cumulativeRank >= sourceRank) hi = mid;
      else lo = mid + 1;
    }
    targetScore = tgtData[Math.min(lo, tgtData.length - 1)].score;
  }

  return {
    sourceYear, targetYear, sourceScore, targetScore,
    sourceRank, confidence
  };
}

// ============================================================
// 录取概率
// ============================================================

function normalCdf(x, mu, sigma) {
  if (sigma <= 0) return x >= mu ? 1 : 0;
  return 0.5 * (1 + erf((x - mu) / (sigma * Math.SQRT2)));
}

function erf(z) {
  // 近似误差函数
  const a1 =  0.254829592, a2 = -0.284496736, a3 =  1.421413741;
  const a4 = -1.453152027, a5 =  1.061405429, p  =  0.3275911;
  const sign = z < 0 ? -1 : 1;
  z = Math.abs(z);
  const t = 1 / (1 + p * z);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-z * z);
  return sign * y;
}

export function calcProbability(userRank, historyRanks, method = 'normal_distribution') {
  if (!historyRanks || historyRanks.length === 0) {
    return { probability: 0, tier: '冲', riskFactors: ['无历史数据'] };
  }

  let probability;
  if (method === 'percentile') {
    const above = historyRanks.filter(r => r >= userRank).length;
    probability = above / historyRanks.length;
  } else if (method === 'conservative') {
    const minR = Math.min(...historyRanks);
    const maxR = Math.max(...historyRanks);
    if (userRank <= minR) probability = 1;
    else if (userRank >= maxR) probability = 0;
    else probability = (maxR - userRank) / (maxR - minR);
  } else {
    // normal_distribution
    const mu = historyRanks.reduce((a, b) => a + b, 0) / historyRanks.length;
    const sigma = Math.max(1, Math.sqrt(historyRanks.reduce((sum, r) => sum + (r - mu) ** 2, 0) / historyRanks.length));
    probability = 1 - normalCdf(userRank, mu, sigma);
  }

  probability = Math.max(0, Math.min(1, probability));
  const tier = probability >= 0.7 ? '保' : probability >= 0.3 ? '稳' : '冲';

  const riskFactors = [];
  if (historyRanks.length < 3) riskFactors.push(`仅 ${historyRanks.length} 年数据，参考有限`);
  const range = Math.max(...historyRanks) - Math.min(...historyRanks);
  if (range > 5000) riskFactors.push(`历史位次波动较大（跨度 ${range}）`);
  if (probability < 0.3) riskFactors.push('同位分换算基于近似，实际存在不确定性');

  return { probability, tier, riskFactors, historyRanks, userRank, method };
}
