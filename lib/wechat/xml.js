/**
 * 微信 XML 消息解析与构建
 */
import { XMLBuilder, XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({
  ignoreAttributes: true,
  trimValues: true,
  parseTagValue: false,
  isArray: () => false,
});

const builder = new XMLBuilder({
  ignoreAttributes: true,
  cdataPropName: '__cdata',
  format: false,
});

function cdata(value) {
  return { __cdata: value };
}

/**
 * 解析微信传入的 XML 消息
 */
export function parseIncomingXml(xml) {
  const parsed = parser.parse(xml);
  const msg = parsed.xml;

  return {
    ToUserName: msg.ToUserName,
    FromUserName: msg.FromUserName,
    CreateTime: Number(msg.CreateTime),
    MsgType: msg.MsgType,
    MsgId: msg.MsgId ? Number(msg.MsgId) : undefined,
    Content: msg.Content,
    PicUrl: msg.PicUrl,
    MediaId: msg.MediaId,
    Format: msg.Format,
    Recognition: msg.Recognition,
    Event: msg.Event,
    EventKey: msg.EventKey,
    Ticket: msg.Ticket,
    Latitude: msg.Latitude ? Number(msg.Latitude) : undefined,
    Longitude: msg.Longitude ? Number(msg.Longitude) : undefined,
    Label: msg.Label,
    Title: msg.Title,
    Description: msg.Description,
    Url: msg.Url,
  };
}

/**
 * 提取 XML 中的 Encrypt 字段
 */
export function extractEncryptField(xml) {
  try {
    const parsed = parser.parse(xml);
    return parsed.xml?.Encrypt || null;
  } catch (_) {
    return null;
  }
}

/**
 * 构建文本回复 XML
 */
export function buildTextReply(toUser, fromUser, content) {
  return builder.build({
    xml: {
      ToUserName: cdata(toUser),
      FromUserName: cdata(fromUser),
      CreateTime: Math.floor(Date.now() / 1000),
      MsgType: cdata('text'),
      Content: cdata(content),
    },
  });
}

/**
 * 构建图片回复 XML
 */
export function buildImageReply(toUser, fromUser, mediaId) {
  return builder.build({
    xml: {
      ToUserName: cdata(toUser),
      FromUserName: cdata(fromUser),
      CreateTime: Math.floor(Date.now() / 1000),
      MsgType: cdata('image'),
      Image: { MediaId: cdata(mediaId) },
    },
  });
}

/**
 * 根据回复类型构建 XML
 */
export function buildReplyXml(message, reply) {
  if (!reply) return null;

  const toUser = message.FromUserName;
  const fromUser = message.ToUserName;

  if (reply.type === 'text') {
    return buildTextReply(toUser, fromUser, reply.content);
  }

  return buildImageReply(toUser, fromUser, reply.mediaId);
}

/**
 * 构建加密模式下回复的 XML
 */
export function buildEncryptedResponseXml(encrypt, msgSignature, timestamp, nonce) {
  return builder.build({
    xml: {
      Encrypt: cdata(encrypt),
      MsgSignature: cdata(msgSignature),
      TimeStamp: timestamp,
      Nonce: cdata(nonce),
    },
  });
}
