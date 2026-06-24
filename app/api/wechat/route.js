/**
 * 微信公众号服务器入口
 *
 * GET  - 服务器配置验证（微信发送的验证请求）
 * POST - 接收用户消息并被动回复（5秒内返回）
 *
 * 支持明文/兼容/安全三种模式
 */

import { randomBytes } from 'crypto';
import { NextResponse } from 'next/server';
import { getWechatConfig, isValidEncodingAesKey } from '@/lib/wechat/config';
import {
  decryptMessage,
  encryptMessage,
  signEncryptedReply,
  verifyMsgSignature,
  verifySignature,
} from '@/lib/wechat/crypto';
import { handleMessage } from '@/lib/wechat/handler';
import { queryAndReply, buildAiPrompt } from '@/lib/gaokao-query';
import { sendCustomerServiceText } from '@/lib/wechat/access-token';
import { findOrCreateWechatUser } from '@/lib/db';
import {
  buildEncryptedResponseXml,
  buildReplyXml,
  extractEncryptField,
  parseIncomingXml,
} from '@/lib/wechat/xml';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getQueryParams(request) {
  const { searchParams } = request.nextUrl;
  return {
    signature: searchParams.get('signature') ?? '',
    timestamp: searchParams.get('timestamp') ?? '',
    nonce: searchParams.get('nonce') ?? '',
    echostr: searchParams.get('echostr') ?? '',
    msgSignature: searchParams.get('msg_signature') ?? '',
  };
}

function xmlResponse(body, status = 200) {
  return new NextResponse(body, {
    status,
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
}

function textResponse(body, status = 200) {
  return new NextResponse(body, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

/**
 * 异步生成 AI 分析并通过客服消息发送（不阻塞主回复）
 */
async function sendAiAnalysisAsync(config, openId, text) {
  try {
    // 只对高考查询类消息做 AI 分析
    if (!text || !/\d{3}\s*分/.test(text)) return

    const result = await queryAndReply(text)
    if (!result?.complete) return

    const userPrompt = await buildAiPrompt(result.info, result.data, result.years)
    const apiKey = process.env.DEEPSEEK_API_KEY
    if (!apiKey || apiKey === 'sk-your-key-here') return

    const resp = await fetch(
      process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/v1/chat/completions',
      {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
          messages: [
            { role: 'system', content: '你是一个高考志愿填报助手，基于提供的真实数据帮考生分析分数位次。数据均为历史年份，禁止承诺录取。语言通俗易懂。' },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.3,
          max_tokens: 1000,
        }),
        signal: AbortSignal.timeout(15000),
      },
    )
    if (!resp.ok) return
    const json = await resp.json()
    const content = json.choices?.[0]?.message?.content
    if (!content) return

    const prefix = '🤖 AI 分析结果：\n\n'
    const fullMsg = prefix + (content.length > 1800 ? content.slice(0, 1760) + '\n\n……（已截断）' : content)

    await sendCustomerServiceText(config.appId, config.appSecret, openId, fullMsg)
  } catch (err) {
    console.error('[wechat] ai analysis failed:', err.message)
  }
}

/**
 * 微信服务器配置验证（GET）
 * 在公众号后台填写服务器 URL 后，微信会发送 GET 请求验证
 */
export async function GET(request) {
  try {
    const config = getWechatConfig();
    const { signature, timestamp, nonce, echostr, msgSignature } = getQueryParams(request);

    const useEncryption = Boolean(msgSignature) && isValidEncodingAesKey(config.encodingAesKey);

    if (useEncryption && config.encodingAesKey) {
      if (!verifyMsgSignature(config.token, timestamp, nonce, echostr, msgSignature)) {
        return textResponse('Invalid signature', 403);
      }
      const plain = decryptMessage(config.encodingAesKey, config.appId, echostr);
      return textResponse(plain);
    }

    if (!verifySignature(config.token, timestamp, nonce, signature)) {
      return textResponse('Invalid signature', 403);
    }

    return textResponse(echostr);
  } catch (error) {
    console.error('[wechat GET]', error);
    return textResponse('Server error', 500);
  }
}

/**
 * 接收用户消息并被动回复（POST）
 * 微信要求 5 秒内返回，否则不会展示回复
 */
export async function POST(request) {
  try {
    const config = getWechatConfig();
    const { signature, timestamp, nonce, msgSignature } = getQueryParams(request);
    const rawBody = await request.text();
    const encryptField = extractEncryptField(rawBody);

    const useEncryption = Boolean(msgSignature && encryptField) && isValidEncodingAesKey(config.encodingAesKey);

    if (encryptField && !useEncryption) {
      return textResponse('encryption not configured', 403);
    }

    let messageXml = rawBody;

    if (useEncryption && config.encodingAesKey) {
      if (!verifyMsgSignature(config.token, timestamp, nonce, encryptField, msgSignature)) {
        return textResponse('Invalid signature', 403);
      }
      messageXml = decryptMessage(config.encodingAesKey, config.appId, encryptField);
    } else if (!verifySignature(config.token, timestamp, nonce, signature)) {
      return textResponse('Invalid signature', 403);
    }

    const message = parseIncomingXml(messageXml);

    console.info('[wechat POST]', {
      msgType: message.MsgType,
      event: message.Event,
      fromUser: message.FromUserName?.slice(0, 8),
      contentLength: message.Content?.length,
    });

    const reply = await handleMessage(message);
    const replyXml = buildReplyXml(message, reply);

    if (!replyXml) {
      return textResponse('success');
    }

    let response;

    if (useEncryption && config.encodingAesKey) {
      const responseNonce = randomBytes(8).toString('hex');
      const responseTimestamp = Math.floor(Date.now() / 1000).toString();
      const encryptedReply = encryptMessage(config.encodingAesKey, config.appId, replyXml);
      const msgSig = signEncryptedReply(config.token, responseTimestamp, responseNonce, encryptedReply);

      response = xmlResponse(
        buildEncryptedResponseXml(encryptedReply, msgSig, responseTimestamp, responseNonce),
      );
    } else {
      response = xmlResponse(replyXml);
    }

    // 异步发送 AI 分析（不阻塞主回复）
    const openId = message.FromUserName
    if (openId && reply?.type === 'text') {
      sendAiAnalysisAsync(config, openId, message.Content).catch(() => {})
    }

    return response;
  } catch (error) {
    console.error('[wechat POST]', error);
    // 微信要求即使出错也要返回 success
    return textResponse('success');
  }
}
