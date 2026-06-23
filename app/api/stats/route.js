import { NextResponse } from 'next/server';
import { readdirSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';


export async function GET() {
  const dataDir = join(process.cwd(), 'data', 'score_rank');
  let totalRecords = 0;
  const provinceSet = new Set();
  const yearSet = new Set();
  const classifySet = new Set();
  const coverage = [];

  if (existsSync(dataDir)) {
    const files = readdirSync(dataDir).filter(f => f.endsWith('.json') && !f.startsWith('_'));
    for (const file of files) {
      const [province, year, classify] = file.replace('.json', '').split('_');
      provinceSet.add(province);
      yearSet.add(year);
      classifySet.add(classify);
      const records = JSON.parse(readFileSync(join(dataDir, file), 'utf-8'));
      totalRecords += records.length;
    }

    // 按省份+年份聚合
    const agg = {};
    for (const file of files) {
      const [province, year, classify] = file.replace('.json', '').split('_');
      const key = `${province}_${year}`;
      if (!agg[key]) agg[key] = { province, year, classifyCount: new Set() };
      agg[key].classifyCount.add(classify);
    }
    for (const v of Object.values(agg)) {
      coverage.push({ province: v.province, year: Number(v.year), classify_count: v.classifyCount.size });
    }
    coverage.sort((a, b) => a.province.localeCompare(b.province) || b.year - a.year);
  }

  return NextResponse.json({
    total_records: totalRecords,
    provinces: provinceSet.size,
    years: yearSet.size,
    classify_types: classifySet.size,
    coverage,
  });
}
