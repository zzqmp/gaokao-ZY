/**
 * 微信公众号消息处理
 * 将微信用户消息转换为高考志愿查询，返回格式化回复
 */
import { queryAndReply, buildClarifyingQuestion, getAvailableYears } from '@/lib/gaokao-query';
import { getWechatConfig } from '@/lib/wechat/config';
import { sendCustomerServiceText } from '@/lib/wechat/access-token';

/**
 * 检查文本是否是关于高考志愿的查询
 */
function isGaokaoQuery(text) {
  const keywords = [
    '分', '高考', '志愿', '位次', '排名', '录取', '大学', '学院',
    '专业', '投档', '批次', '本科', '专科', '文科', '理科',
    '物理', '历史', '综合', '3+1+2', '3+3', '新高考', '老高考',
    '粤', '京', '沪', '津', '渝', // 省份简称
  ];
  const lower = text.toLowerCase();
  return keywords.some(k => lower.includes(k)) || /\d{3}\s*分/.test(text);
}

/**
 * 获取随机 emoji 前缀（避免回复太单调）
 */
function getRandomEmoji() {
  const emojis = ['🎯', '📊', '📈', '💡', '🔍', '✨', '🎓', '📚', '⚡', '💪'];
  return emojis[Math.floor(Math.random() * emojis.length)];
}

/**
 * 格式化微信回复（纯文本，限制在 2048 字以内）
 */
function formatWechatReply(info, data, years) {
  if (!data?.byYear) return '暂时无法查询到相关数据，请稍后再试。';

  const primaryYear = years[0];
  const primaryData = data.byYear[primaryYear];
  if (!primaryData?.rank) {
    return `${info.province || ''}${info.classify || ''}${info.score || ''}分暂无完整位次数据。`;
  }

  const lines = [];

  // 第一行：核心信息
  const emoji = getRandomEmoji();
  lines.push(`${emoji} ${info.province}${info.classify} · ${info.score}分`);
  lines.push(`全省位次：${primaryData.rank}名${primaryData.percentile ? '（前'+primaryData.percentile+'%）' : ''}`);
  lines.push(`同分人数：${primaryData.sameScoreNum}人`);
  lines.push('');

  // 多年趋势
  if (years.length >= 2) {
    lines.push('─ 近年趋势 ─');
    for (const year of years) {
      const yd = data.byYear[year];
      if (yd?.rank) {
        const arrow = yd.rank !== primaryData.rank ? (yd.rank > primaryData.rank ? '↓位次降' : '↑位次升') : '';
        lines.push(`${year}年 ${yd.rank}名${arrow ? ' ('+arrow+')' : ''}`);
      }
    }
    lines.push('');
  }

  // 批次线
  if (data.batchLinesByYear?.[primaryYear]?.length > 0) {
    lines.push('─ 批次对比 ─');
    for (const b of data.batchLinesByYear[primaryYear]) {
      if (b.diff !== null) {
        const icon = b.diff > 0 ? '✅超' : '❌差';
        lines.push(`${b.batch} ${b.score}分 ${icon}${Math.abs(b.diff)}分`);
      }
    }
    lines.push('');
  }

  // 冲稳保
  const rank = primaryData.rank;
  lines.push('─ 冲稳保参考 ─');
  lines.push(`冲刺：${Math.max(1, Math.round(rank * 0.85))}～${rank}名`);
  lines.push(`稳妥：${rank}～${Math.round(rank * 1.3)}名`);
  lines.push(`保底：${Math.round(rank * 1.3)}～${Math.round(rank * 2.0)}名`);
  lines.push('');

  // 大学数据
  if (data.universityData?.records?.length > 0) {
    const uniSet = new Set();
    for (const r of data.universityData.records) {
      if (!uniSet.has(r.university)) {
        uniSet.add(r.university);
        if (r.min_rank) {
          const diff = r.min_rank - rank;
          const tag = diff > 0 ? '🟢' : (diff > -2000 ? '🟡' : '🔴');
          lines.push(`${tag} ${r.university}${r.major ? '·'+r.major : ''}`);
          lines.push(`  最低${r.min_rank}名`);
        }
      }
    }
    lines.push('');
  }

  // 尾部提示
  lines.push('💬 回复「详细」获取完整分析');
  lines.push('⚠️ 基于历史数据，仅供参考');

  let text = lines.join('\n');

  // 微信被动回复有长度限制，截断
  if (text.length > 2000) {
    text = text.slice(0, 1960) + '\n\n...（内容过长已截断）\n回复「详细」获取完整分析';
  }

  return text;
}

/**
 * 主处理函数：接收微信消息，返回回复
 */
export async function handleMessage(message) {
  const { MsgType, Content, Event, EventKey, FromUserName } = message;

  // ---- 事件消息 ----
  if (MsgType === 'event') {
    if (Event === 'subscribe') {
      return {
        type: 'text',
        content: [
          '🎓 欢迎关注高考志愿助手！',
          '',
          '发送你的高考分数和省份，即可获取：',
          '✅ 全省位次排名',
          '✅ 近年位次趋势',
          '✅ 批次线对比',
          '✅ 冲稳保参考区间',
          '',
          '例如：',
          '「广东物理600分」',
          '「四川理科550分」',
          '「北京620分想学计算机」',
        ].join('\n'),
      };
    }

    if (Event === 'unsubscribe') return null;

    if (Event === 'CLICK' && EventKey) {
      return { type: 'text', content: `你点击了菜单：${EventKey}` };
    }

    return null;
  }

  // ---- 文本消息 ----
  if (MsgType === 'text' && Content) {
    const text = Content.trim();

    // 详细 / 完整分析
    if (text === '详细' || text === '完整分析' || text === 'more' || text === 'detail') {
      return {
        type: 'text',
        content: [
          '💡 想要更详细的分析？请发送更具体的信息：',
          '',
          '• 带上目标大学查询录取概率',
          '  例：「广东物理600分 想报中山大学」',
          '',
          '• 查询同位分换算',
          '  例：「广东物理600分相当于去年多少分」',
          '',
          '• 查询具体专业录取位次',
          '  例：「广东物理600分 想学计算机」',
          '',
          '📌 当前回复已包含核心位次和冲稳保信息。',
          '更精细的分析需要结合具体的大学和专业数据。',
        ].join('\n'),
      };
    }

    // 帮助指令
    if (text === '帮助' || text === 'help' || text === 'help') {
      return {
        type: 'text',
        content: [
          '🎓 高考志愿助手使用说明',
          '',
          '直接发送你的高考情况即可查询：',
          '• 「广东物理600分」',
          '• 「四川理科550分」',
          '• 「北京620分 想学计算机」',
          '• 「查清华 广东物理600分」',
          '',
          '也可回复：',
          '• 「详细」- 获取更详细的分析',
          '• 「帮助」- 显示此帮助',
        ].join('\n'),
      };
    }

    // 判断是否高考相关查询
    if (isGaokaoQuery(text)) {
      try {
        const result = await queryAndReply(text);

        if (!result.complete) {
          // 需要补充信息
          return { type: 'text', content: result.reply };
        }

        // 生成微信友好的回复
        const reply = formatWechatReply(result.info, result.data, result.years);

        // 如果回复很短或在 5 秒内可能来不及完成，先快速回复摘要
        // 这里直接返回完整的被动回复
        return { type: 'text', content: reply };

      } catch (err) {
        console.error('[wechat handler] query error:', err);
        return {
          type: 'text',
          content: '😅 查询出错了，请稍后再试。如果问题持续，请回复「帮助」获取使用说明。',
        };
      }
    }

    // 非高考消息的通用回复
    return {
      type: 'text',
      content: [
        '🤖 我是高考志愿助手，专门帮你分析高考分数和位次。',
        '',
        '请发送你的高考信息，例如：',
        '「广东物理600分」',
        '「四川理科550分 想报川大」',
        '',
        '回复「帮助」查看更多功能。',
      ].join('\n'),
    };
  }

  // ---- 其他类型消息 ----
  if (MsgType === 'image') {
    return { type: 'text', content: '请发送文字消息描述你的高考情况，暂不支持图片识别 😅' };
  }

  if (MsgType === 'voice') {
    const recog = message.Recognition || '（未识别）';
    // 语音消息的识别结果可能包含高考信息，递归处理
    if (isGaokaoQuery(recog)) {
      return handleMessage({ ...message, MsgType: 'text', Content: recog });
    }
    return { type: 'text', content: `收到语音：${recog}\n\n请发送文字消息描述你的高考情况。` };
  }

  return { type: 'text', content: '暂不支持该类型消息，请发送文字消息。' };
}
