/**
 * 微信配置状态检查
 */
import { getWechatConfig, isValidEncodingAesKey } from '@/lib/wechat/config';
import { getAccessToken } from '@/lib/wechat/access-token';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const checks = [];

  // 环境变量检查
  checks.push({ name: 'WECHAT_TOKEN', ok: !!process.env.WECHAT_TOKEN });
  checks.push({ name: 'WECHAT_APP_ID', ok: !!process.env.WECHAT_APP_ID });
  checks.push({ name: 'WECHAT_APP_SECRET', ok: !!process.env.WECHAT_APP_SECRET });
  checks.push({
    name: 'WECHAT_ENCODING_AES_KEY',
    ok: !process.env.WECHAT_ENCODING_AES_KEY || isValidEncodingAesKey(process.env.WECHAT_ENCODING_AES_KEY),
    note: process.env.WECHAT_ENCODING_AES_KEY ? '已配置' : '未配置（明文模式可用）',
  });

  // access_token 测试
  let tokenTest = null;
  if (process.env.WECHAT_APP_ID && process.env.WECHAT_APP_SECRET) {
    try {
      const token = await getAccessToken(process.env.WECHAT_APP_ID, process.env.WECHAT_APP_SECRET);
      tokenTest = { ok: true, note: `获取成功（${token.slice(0, 8)}...）` };
    } catch (err) {
      tokenTest = { ok: false, note: err.message };
    }
  }

  const allOk = checks.every(c => c.ok) && (!tokenTest || tokenTest.ok);

  return Response.json({
    ok: allOk,
    checks,
    tokenTest,
    timestamp: new Date().toISOString(),
  });
}
