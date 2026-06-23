/**
 * 数据库连接状态检查
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const checks = {};

  const dbUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  checks.hasEnv = !!dbUrl;

  if (!dbUrl) {
    return Response.json({
      ok: false,
      source: 'JSON',
      message: '未设置 DATABASE_URL，当前使用 JSON 文件',
      checks,
    });
  }

  try {
    const { Pool } = new Function('m', 'return require(m)')('pg');
    const pool = new Pool({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
    const { rows } = await pool.query('SELECT COUNT(*) as cnt FROM score_rank');
    const count = parseInt(rows[0]?.cnt || '0');
    checks.connected = true;
    checks.scoreRankCount = count;
    checks.hasData = count > 0;

    if (count > 0) {
      const sample = await pool.query(
        'SELECT province, year, classify, score, "cumulativeRank" FROM score_rank LIMIT 3'
      );
      checks.sample = sample.rows;

      await pool.end();
      return Response.json({
        ok: true,
        source: 'PostgreSQL (pg)',
        message: '✅ 数据库连接正常，有数据',
        checks,
      });
    } else {
      await pool.end();
      return Response.json({
        ok: false,
        source: 'PostgreSQL (pg)',
        message: '数据库已连接但 score_rank 表为空，需先运行迁移脚本',
        checks,
      });
    }
  } catch (err) {
    checks.connected = false;
    checks.error = err.message || String(err);
    return Response.json({
      ok: false,
      source: 'JSON（降级）',
      message: '数据库连接失败，当前降级使用 JSON 文件',
      checks,
    });
  }
}
