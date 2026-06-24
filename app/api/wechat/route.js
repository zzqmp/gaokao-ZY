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
import { handleMessage, runAiAnalysisAndStore } from '@/lib/wechat/handler';
import { savePendingReply, getPendingReplyByMsgId, getUserPendingReply, deletePendingReply, cleanExpiredPendingReplies } from '@/lib/db';
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
 *
 * 混合策略（方案 A + B）：
 *   B: 微信重试时从 DB 取已完成的 AI 分析结果
 *   A: AI 分析结果存 DB，用户下条消息时自动合并送达
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
    const { MsgType, Content, Event, FromUserName, MsgId } = message;

    console.info('[wechat POST]', {
      msgType: MsgType,
      event: Event,
      fromUser: FromUserName?.slice(0, 8),
      contentLength: Content?.length,
      msgId: MsgId,
    });

    // 顺手清理过期 pending 记录（24h 以上），不阻塞
    cleanExpiredPendingReplies().catch(() => {});

    // ============================================================
    // 方案 B：微信重试路径
    // 如果 MsgId 已在 DB 中且 AI 分析完成，直接返回缓存结果
    // ============================================================
    let reply;
    let skipHandleMessage = false;
    const msgId = MsgId ? String(MsgId) : null;

    if (msgId && MsgType === 'text' && Content) {
      const cached = await getPendingReplyByMsgId(msgId).catch(() => null);
      if (cached) {
        if (cached.status === 'done') {
          // AI 分析已完成 → 返回缓存结果，跳过 handleMessage（避免重复扣积分）
          reply = { type: 'text', content: cached.reply_text };
          skipHandleMessage = true;
          await deletePendingReply(msgId).catch(() => {});
          console.info('[wechat retry] delivered cached AI reply for msgId:', msgId);
        } else if (cached.status === 'pending') {
          // AI 还在运行 → 短轮询等结果
          for (let i = 0; i < 6; i++) {
            await new Promise(r => setTimeout(r, 500));
            const updated = await getPendingReplyByMsgId(msgId).catch(() => null);
            if (updated?.status === 'done') {
              reply = { type: 'text', content: updated.reply_text };
              skipHandleMessage = true;
              await deletePendingReply(msgId).catch(() => {});
              console.info('[wechat retry] AI completed during poll for msgId:', msgId);
              break;
            }
          }
          // 轮询结束仍未完成 → 返回"处理中"让微信继续重试
          if (!reply) {
            reply = { type: 'text', content: '⏳ 分析结果正在生成中，请稍候...' };
            skipHandleMessage = true;
          }
        }
      }
    }

    // ============================================================
    // 正常路径：处理消息（数据查询同步）
    // 加 4 秒硬超时，确保 5 秒内一定有回复返回
    // ============================================================
    if (!reply) {
      const TIMEOUT_MS = 4000;
      const result = await Promise.race([
        handleMessage(message).then(r => ({ ok: true, reply: r })),
        new Promise(r => setTimeout(() => r({ ok: false }), TIMEOUT_MS)),
      ]);

      if (result.ok) {
        reply = result.reply;
      } else {
        // 超时了 → 立即返回"处理中"
        // 数据查询结果会通过 AI 分析流程（下方 AI dispatch）异步完成并存储，
        // 用户下条消息时由方案 A 兜底合并送达
        reply = { type: 'text', content: '⏳ 正在查询数据，请稍后发送任意消息获取完整结果。' };
      }
    }

    // ============================================================
    // AI 分析异步调度
    // 高考查询消息在返回数据结果后，后台启动 AI 分析
    // ============================================================
    const isScoreQuery = !!(Content && /\d{3}\s*分/.test(Content));
    if (!skipHandleMessage && FromUserName && isScoreQuery && reply?.type === 'text') {
      const uid = msgId || `${FromUserName}_${Date.now()}`;
      // 存 pending 记录（供微信重试路径使用）
      await savePendingReply(uid, FromUserName, Content).catch(() => {});
      // 异步执行 AI 分析，完成后自动 updatePendingReply
      runAiAnalysisAndStore(Content, FromUserName, uid).catch(() => {});
    }

    // ============================================================
    // 方案 A 兜底：合并没有通过微信重试送达的 AI 结果
    // 如果用户有来自之前查询的未送达 AI 结果，追加到本次回复
    // ============================================================
    if (!skipHandleMessage && FromUserName && reply?.type === 'text') {
      const pending = await getUserPendingReply(FromUserName).catch(() => null);
      if (pending && pending.msg_id !== msgId) {
        reply.content = reply.content + '\n\n---\n' + pending.reply_text;
        await deletePendingReply(pending.msg_id).catch(() => {});
        console.info('[wechat pending] merged pending AI reply for user:', FromUserName.slice(0, 8));
      }
    }

    // ============================================================
    // 构建 XML 响应
    // ============================================================
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

    return response;
  } catch (error) {
    console.error('[wechat POST]', error);
    // 微信要求即使出错也要返回 success
    return textResponse('success');
  }
}
