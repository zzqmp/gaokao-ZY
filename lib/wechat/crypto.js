/**
 * 微信消息加解密和签名验证
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

function sha1(input) {
  return createHash('sha1').update(input).digest('hex');
}

/**
 * 验证普通签名（明文模式）
 */
export function verifySignature(token, timestamp, nonce, signature) {
  const sorted = [token, timestamp, nonce].sort().join('');
  return sha1(sorted) === signature;
}

/**
 * 验证消息体签名（安全/兼容模式）
 */
export function verifyMsgSignature(token, timestamp, nonce, encrypt, msgSignature) {
  const sorted = [token, timestamp, nonce, encrypt].sort().join('');
  return sha1(sorted) === msgSignature;
}

function getAesKey(encodingAesKey) {
  return Buffer.from(`${encodingAesKey}=`, 'base64');
}

function pkcs7Unpad(buffer) {
  const pad = buffer[buffer.length - 1];
  if (pad < 1 || pad > 32) return buffer;
  return buffer.subarray(0, buffer.length - pad);
}

function pkcs7Pad(buffer, blockSize = 32) {
  const pad = blockSize - (buffer.length % blockSize);
  const padding = Buffer.alloc(pad, pad);
  return Buffer.concat([buffer, padding]);
}

/**
 * 解密微信加密消息
 */
export function decryptMessage(encodingAesKey, appId, encrypted) {
  const aesKey = getAesKey(encodingAesKey);
  const iv = aesKey.subarray(0, 16);
  const decipher = createDecipheriv('aes-256-cbc', aesKey, iv);
  decipher.setAutoPadding(false);

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encrypted, 'base64')),
    decipher.final(),
  ]);
  const content = pkcs7Unpad(decrypted);

  const msgLen = content.readUInt32BE(16);
  const msg = content.subarray(20, 20 + msgLen).toString('utf8');
  const receivedAppId = content.subarray(20 + msgLen).toString('utf8');

  if (receivedAppId !== appId) {
    throw new Error('AppId mismatch in decrypted message');
  }

  return msg;
}

/**
 * 加密回复消息
 */
export function encryptMessage(encodingAesKey, appId, replyXml) {
  const aesKey = getAesKey(encodingAesKey);
  const iv = aesKey.subarray(0, 16);
  const randomStr = randomBytes(16);
  const msgBuffer = Buffer.from(replyXml, 'utf8');
  const msgLen = Buffer.alloc(4);
  msgLen.writeUInt32BE(msgBuffer.length, 0);

  const plain = Buffer.concat([
    randomStr,
    msgLen,
    msgBuffer,
    Buffer.from(appId, 'utf8'),
  ]);
  const padded = pkcs7Pad(plain);

  const cipher = createCipheriv('aes-256-cbc', aesKey, iv);
  cipher.setAutoPadding(false);
  const encrypted = Buffer.concat([cipher.update(padded), cipher.final()]);
  return encrypted.toString('base64');
}

/**
 * 签名加密回复
 */
export function signEncryptedReply(token, timestamp, nonce, encrypt) {
  const sorted = [token, timestamp, nonce, encrypt].sort().join('');
  return sha1(sorted);
}
