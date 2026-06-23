/**
 * 数据迁移脚本：JSON → PostgreSQL
 * 运行方式：node scripts/migrate_to_postgres.mjs
 * 需要设置环境变量 POSTGRES_URL 或 DATABASE_URL
 */
import pg from 'pg';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DATA_DIR = join(__dirname, '..', 'data');

async function migrate() {
  const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('❌ 请设置 POSTGRES_URL 或 DATABASE_URL 环境变量');
    process.exit(1);
  }

  console.log('🔄 连接 PostgreSQL...');

  // 用 pg.Pool 直连（绕过 @vercel/postgres 的连接串校验）
  const pool = new pg.Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
  });

  // 测试连接
  try {
    const result = await pool.query('SELECT 1 as ok');
    console.log('✅ 已连接 PostgreSQL');
  } catch (err) {
    console.error('❌ 连接失败:', err.message);
    console.error('  请检查：');
    console.error('  1. 连接串是否正确（有没有换行/空格）');
    console.error('  2. 网络是否能访问 db.prisma.io:5432');
    console.error('  3. 防火墙是否拦截了出站连接');
    await pool.end();
    process.exit(1);
  }

  const q = (sql, params) => pool.query(sql, params);

  try {
    // 1. 创建表结构
    console.log('\n📦 创建表结构...');

    await q(`CREATE TABLE IF NOT EXISTS score_rank (
      id SERIAL PRIMARY KEY,
      province TEXT NOT NULL,
      year TEXT NOT NULL,
      classify TEXT NOT NULL,
      score INTEGER NOT NULL,
      "sameScoreNum" INTEGER DEFAULT 0,
      "cumulativeRank" INTEGER DEFAULT 0,
      UNIQUE(province, year, classify, score)
    )`);

    await q('DROP TABLE IF EXISTS admission CASCADE');
    await q(`CREATE TABLE IF NOT EXISTS admission (
      id SERIAL PRIMARY KEY,
      year INTEGER,
      province TEXT,
      university TEXT,
      major TEXT,
      major_group TEXT,
      batch TEXT,
      student_type TEXT,
      min_rank INTEGER,
      max_rank INTEGER,
      avg_rank INTEGER,
      admit_count INTEGER,
      plan_count INTEGER,
      score_min INTEGER,
      score_avg INTEGER,
      source TEXT,
      source_url TEXT,
      verified_at TEXT,
      created_at TEXT,
      updated_at TEXT
    )`);

    await q(`CREATE TABLE IF NOT EXISTS batch_lines (
      id SERIAL PRIMARY KEY,
      province TEXT,
      year TEXT,
      student_type TEXT,
      batch TEXT,
      score INTEGER,
      rank INTEGER
    )`);

    console.log('✅ 表结构创建完成');

    // 2. 迁移 score_rank 数据
    console.log('\n📊 迁移 score_rank 数据...');
    const srIndexPath = join(DATA_DIR, 'score_rank', '_index.json');
    if (existsSync(srIndexPath)) {
      const index = JSON.parse(readFileSync(srIndexPath, 'utf-8'));
      let totalInserted = 0;
      for (const [province, years] of Object.entries(index)) {
        for (const [year, classifies] of Object.entries(years)) {
          for (const classify of classifies) {
            const filePath = join(DATA_DIR, 'score_rank', `${province}_${year}_${classify}.json`);
            if (!existsSync(filePath)) continue;
            const records = JSON.parse(readFileSync(filePath, 'utf-8'));
            const BATCH_SIZE = 2000;
            for (let i = 0; i < records.length; i += BATCH_SIZE) {
              const batch = records.slice(i, i + BATCH_SIZE);
              const values = batch.map((r, idx) =>
                `($${idx * 5 + 1}, $${idx * 5 + 2}, $${idx * 5 + 3}, $${idx * 5 + 4}, $${idx * 5 + 5})`
              ).join(',');
              const params = batch.flatMap(r => [province, year, classify, r.score, r.cumulativeRank]);
              await q(
                `INSERT INTO score_rank (province, year, classify, score, "cumulativeRank")
                 VALUES ${values} ON CONFLICT (province, year, classify, score) DO NOTHING`,
                params
              );
            }
            totalInserted += records.length;
            process.stdout.write(`\r  ${province} ${year} ${classify}: ${records.length} 条`);
          }
        }
      }
      console.log(`\n✅ score_rank 迁移完成，共 ${totalInserted} 条`);
    }

    // 3. 迁移 admission 数据
    console.log('\n📊 迁移 admission 数据...');
    const admDir = join(DATA_DIR, 'admission');
    if (existsSync(admDir)) {
      const files = readdirSync(admDir).filter(f => f.endsWith('.json') && f !== '_index.json');
      let totalInserted = 0;
      for (const file of files) {
        const filePath = join(admDir, file);
        const records = JSON.parse(readFileSync(filePath, 'utf-8'));
        const BATCH_SIZE = 3000;
        for (let i = 0; i < records.length; i += BATCH_SIZE) {
          const batch = records.slice(i, i + BATCH_SIZE);
          const values = batch.map((r, idx) => {
            const base = idx * 17;
            return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}, $${base + 11}, $${base + 12}, $${base + 13}, $${base + 14}, $${base + 15}, $${base + 16}, $${base + 17})`;
          }).join(',');
          const params = batch.flatMap(r => [
            r.year, r.province, r.university, r.major || '',
            r.major_group || '', r.batch || '', r.student_type || '',
            r.min_rank, r.max_rank, r.avg_rank, r.admit_count, r.plan_count,
            r.score_min, r.score_avg, r.source || '', r.source_url || '',
            r.updated_at || null
          ]);
          try {
            await q(
              `INSERT INTO admission (year, province, university, major, major_group, batch, student_type,
                min_rank, max_rank, avg_rank, admit_count, plan_count, score_min, score_avg, source, source_url, updated_at)
               VALUES ${values}`,
              params
            );
          } catch (e) {
            console.error(`\n❌ 插入 ${file} 出错:`, e.message);
          }
        }
        totalInserted += records.length;
        process.stdout.write(`\r  已迁移 ${files.indexOf(file) + 1}/${files.length} 个省份文件`);
      }
      console.log(`\n✅ admission 迁移完成，共 ${totalInserted} 条`);
    }

    // 4. 创建索引
    console.log('\n🔍 创建索引...');
    await q('CREATE INDEX IF NOT EXISTS idx_score_rank_lookup ON score_rank(province, year, classify, score)');
    await q('CREATE INDEX IF NOT EXISTS idx_score_rank_prov_year_class ON score_rank(province, year, classify)');
    await q('CREATE INDEX IF NOT EXISTS idx_admission_province ON admission(province)');
    await q('CREATE INDEX IF NOT EXISTS idx_admission_university ON admission(university)');
    await q('CREATE INDEX IF NOT EXISTS idx_admission_prov_uni ON admission(province, university)');
    console.log('✅ 索引创建完成');

    console.log('\n🎉 数据迁移全部完成！');
  } catch (e) {
    console.error('\n❌ 迁移失败:', e.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();
