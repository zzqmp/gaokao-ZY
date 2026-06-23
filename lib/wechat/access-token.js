/**
 * 微信 access_token 管理
 * 用于主动推送客服消息
 * Vercel Serverless 环境使用内存缓存，生产建议用 Vercel KV
 */

let cachedToken = null;

export async function getAccessToken(appId, appSecret) {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 60000) {
    return cachedToken.token;
  }

  const url = new URL('https://api.weixin.qq.com/cgi-bin/token');
  url.searchParams.set('grant_type', 'client_credential');
  url.searchParams.set('appid', appId);
  url.searchParams.set('secret', appSecret);

  const res = await fetch(url);
  const data = await res.json();

  if (!data.access_token) {
    throw new Error(`Failed to get access_token: ${data.errcode ?? 'unknown'} ${data.errmsg ?? ''}`);
  }

  cachedToken = {
    token: data.access_token,
    expiresAt: now + (data.expires_in ?? 7200) * 1000,
  };

  return data.access_token;
}

/**
 * 发送客服文本消息
 */
export async function sendCustomerServiceText(appId, appSecret, openId, content) {
  const accessToken = await getAccessToken(appId, appSecret);
  const url = `https://api.weixin.qq.com/cgi-bin/message/custom/send?access_token=${accessToken}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      touser: openId,
      msgtype: 'text',
      text: { content },
    }),
  });

  const data = await res.json();
  if (data.errcode && data.errcode !== 0) {
    throw new Error(`Customer service send failed: ${data.errcode} ${data.errmsg}`);
  }
}
