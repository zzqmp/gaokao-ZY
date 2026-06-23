import { getScoreRankData } from '@/lib/data';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const province = searchParams.get('province');
  const year = searchParams.get('year');
  const classify = searchParams.get('classify');
  const scoreStr = searchParams.get('score');

  if (!province) return Response.json({ error: '缺少 province 参数', hint: '请选择省份' });
  if (!year) return Response.json({ error: '缺少 year 参数', hint: '请选择年份' });
  if (!classify) return Response.json({ error: '缺少 classify 参数', hint: '请选择选科' });
  if (!scoreStr) return Response.json({ error: '缺少 score 参数', hint: '请输入分数' });

  const score = parseInt(scoreStr, 10);
  if (isNaN(score)) return Response.json({ error: '分数格式不正确', hint: '请输入有效数字' });

  const records = await getScoreRankData(province, year, classify);
  if (!records || records.length === 0) {
    return Response.json({
      error: `${year}年${province}${classify}暂无数据`,
      hint: '请检查省份、年份、选科是否选择正确',
    });
  }

  // 查找精确匹配
  const exact = records.find(r => r.score === score);

  // 查找附近 ±5 分的记录
  const nearby = records.filter(r => r.score >= score - 5 && r.score <= score + 5);

  // 转换成前端兼容格式
  const toRecord = (r) => ({
    '返回的查询分数': String(r.score),
    '同分人数': String(r.sameScoreNum),
    '排名位次': String(r.cumulativeRank),
  });

  return Response.json({
    exact: exact ? {
      score: exact.score,
      same_score_num: exact.sameScoreNum,
      cumulative_rank: exact.cumulativeRank,
    } : null,
    records: nearby.map(toRecord),
    province,
    year,
    classify,
    query_score: score,
  });
}
