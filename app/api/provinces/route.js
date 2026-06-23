import { getProvinces, getScoreRankIndex, getAdmissionIndex, getBatchLines } from '@/lib/data';

export async function GET() {
  const [provinces, index, admissionIdx, batchLines] = await Promise.all([
    getProvinces(),
    getScoreRankIndex(),
    getAdmissionIndex(),
    getBatchLines(),
  ]);

  const coverage = {};
  for (const [province, years] of Object.entries(index)) {
    coverage[province] = {};
    for (const [year, classifies] of Object.entries(years)) {
      coverage[province][year] = classifies;
    }
  }

  return Response.json({
    provinces,
    total: provinces.length,
    scoreRankCoverage: coverage,
    totalAdmissionRecords: Object.values(admissionIdx).reduce((s, v) => s + (v.total || 0), 0),
    totalUniversities: Object.values(admissionIdx).reduce((s, v) => s + (v.university_count || 0), 0),
    batchLineCount: batchLines.length,
  });
}
