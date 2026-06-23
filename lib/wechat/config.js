/**
 * 微信公众号配置
 */

export function getWechatConfig() {
  const token = process.env.WECHAT_TOKEN;
  const appId = process.env.WECHAT_APP_ID;
  const appSecret = process.env.WECHAT_APP_SECRET;
  const encodingAesKey = process.env.WECHAT_ENCODING_AES_KEY || '';

  if (!token) throw new Error('Missing required environment variable: WECHAT_TOKEN');
  if (!appId) throw new Error('Missing required environment variable: WECHAT_APP_ID');
  if (!appSecret) throw new Error('Missing required environment variable: WECHAT_APP_SECRET');

  return { token, appId, appSecret, encodingAesKey };
}

export function isValidEncodingAesKey(key) {
  if (!key) return false;
  const trimmed = key.trim();
  return trimmed.length === 43;
}

export function isEncryptionEnabled(config) {
  return isValidEncodingAesKey(config.encodingAesKey);
}
