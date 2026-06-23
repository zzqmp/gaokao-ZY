import { getScoreRankData } from '@/lib/data';

/**
 * 在升序位次数组中二分查找第一个 >= target 的索引
 */
function bisectLeft(arr, target) {
  let lo = 0, hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * 将分数映射为位次
 */
function scoreToRank(records, score) {
  // records 按 score 降序排列
  for (const r of records) {
    if (r.score <= score) return { rank: r.cumulativeRank, confidence: 'high' };
  }
  const last = records[records.length - 1];
  return { rank: last.cumulativeRank, confidence: 'medium' };
}

/**
 * 将位次映射为分数（含线性插值）
 */
function rankToScore(records, rank) {
  if (!records || records.length === 0) return { score: 0, confidence: 'low' };

  const scores = records.map(r => r.score);
  const ranks = records.map(r => r.cumulativeRank);

  const minRank = ranks[0];     // 最高分位次（最小）
  const maxRank = ranks[ranks.length - 1]; // 最低分位次（最大）

  if (rank < minRank) return { score: scores[0], confidence: 'medium' };
  if (rank > maxRank) return { score: scores[scores.length - 1], confidence: 'medium' };

  const idx = bisectLeft(ranks, rank);
  if (idx >= scores.length) return { score: scores[scores.length - 1], confidence: 'medium' };

  if (ranks[idx] === rank) return { score: scores[idx], confidence: 'high' };

  if (idx === 0) return { score: scores[0], confidence: 'medium' };

  const rankHigh = ranks[idx];       // 高位次（数字大）
  const rankLow = ranks[idx - 1];    // 低位次（数字小）
  const scoreHigh = scores[idx];     // 低分
  const scoreLow = scores[idx - 1];  // 高分

  if (rankHigh === rankLow) return { score: scoreHigh, confidence: 'medium' };

  const ratio = (rank - rankLow) / (rankHigh - rankLow);
  const estimatedScore = scoreLow + (scoreHigh - scoreLow) * ratio;

  return { score: Math.round(estimatedScore), confidence: 'high' };
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const province = searchParams.get('province');
  const classify = searchParams.get('classify');
  const sourceYear = searchParams.get('source_year');
  const targetYear = searchParams.get('target_year');
  const scoreStr = searchParams.get('score');

  if (!province) return Response.json({ error: '缺少 province 参数' });
  if (!classify) return Response.json({ error: '缺少 classify 参数' });
  if (!sourceYear) return Response.json({ error: '缺少 source_year 参数' });
  if (!targetYear) return Response.json({ error: '缺少 target_year 参数' });
  if (!scoreStr) return Response.json({ error: '缺少 score 参数' });

  const score = parseInt(scoreStr, 10);
  if (isNaN(score)) return Response.json({ error: '分数格式不正确' });

  const srcRecords = await getScoreRankData(province, sourceYear, classify);
  const tgtRecords = await getScoreRankData(province, targetYear, classify);

  if (!srcRecords || srcRecords.length === 0) {
    return Response.json({ error: `${sourceYear}年${province}${classify}暂无一分一段数据` });
  }
  if (!tgtRecords || tgtRecords.length === 0) {
    return Response.json({ error: `${targetYear}年${province}${classify}暂无一分一段数据` });
  }

  // Step 1: 分数 → 位次
  const { rank, rankConf } = scoreToRank(srcRecords, score);

  // Step 2: 位次 → 等效分
  const { score: targetScore, confidence: scoreConf } = rankToScore(tgtRecords, rank);

  let confidence;
  if (rankConf === 'high' && scoreConf === 'high') confidence = 'high';
  else if (rankConf === 'low' || scoreConf === 'low') confidence = 'low';
  else confidence = 'medium';

  return Response.json({
    source_year: parseInt(sourceYear),
    target_year: parseInt(targetYear),
    source_score: score,
    target_score: targetScore,
    source_rank: rank,
    province,
    classify,
    confidence,
  });
}
