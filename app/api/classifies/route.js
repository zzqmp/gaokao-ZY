import { getProvinceMeta } from '@/lib/data';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const province = searchParams.get('province');
  const year = searchParams.get('year');

  if (!province) {
    return Response.json({ error: '缺少 province 参数' });
  }
  if (!year) {
    return Response.json({ error: '缺少 year 参数' });
  }

  const meta = await getProvinceMeta();
  const info = meta[province];

  if (!info) {
    return Response.json({ error: `未找到省份 ${province} 的信息` });
  }

  const classifies = info.classifies?.[year];
  if (!classifies || classifies.length === 0) {
    return Response.json({
      has_data: false,
      has_year_data: false,
      classifies: [],
      province,
      year,
    });
  }

  return Response.json({
    has_data: true,
    has_year_data: true,
    classifies,
    province,
    year,
  });
}
