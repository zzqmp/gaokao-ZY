/**
 * 自然语言对话式查询 API
 * 使用 lib/gaokao-query.js 共享模块
 */
import { queryAndReply, buildAiPrompt, getAvailableYears, buildFallbackReply } from '@/lib/gaokao-query';
import { getScoreRankIndex } from '@/lib/data';
import { auth } from '@/lib/auth'
import { consumeCredit, getEnabledModels } from '@/lib/db'

// ====== 在线搜索 ======

async function searchWeb(query) {
  const results = [];

  // 1. SerpAPI
  if (process.env.SERPAPI_API_KEY) {
    try {
      const url = 'https://serpapi.com/search.json?q=' + encodeURIComponent(query)
        + '&api_key=' + process.env.SERPAPI_API_KEY + '&engine=google&hl=zh-cn&gl=cn&num=5';
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      const json = await res.json();
      if (json.organic_results) {
        for (const r of json.organic_results) {
          if (r.title) results.push({ title: r.title, snippet: (r.snippet || '').slice(0, 300), url: r.link || '' });
        }
      }
      if (results.length > 0) return results;
    } catch (_) {}
  }

  // 2. Bing fallback
  try {
    const url = 'https://www.bing.com/search?q=' + encodeURIComponent(query + ' 高考');
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      signal: AbortSignal.timeout(8000),
    });
    const html = await res.text();
    const blockRegex = /<li[^>]*class="b_algo"[^>]*>([\s\S]*?)<\/li>/g;
    let m;
    while ((m = blockRegex.exec(html)) !== null && results.length < 5) {
      const block = m[1];
      const titleMatch = block.match(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
      if (!titleMatch) continue;
      const url = titleMatch[1];
      const title = titleMatch[2].replace(/<[^>]+>/g, '').trim();
      const snippetMatch = block.match(/<p[^>]*>([\s\S]*?)<\/p>/);
      const snippet = snippetMatch ? snippetMatch[1].replace(/<[^>]+>/g, '').trim() : '';
      if (title) results.push({ title, snippet, url });
    }
  } catch (_) {}

  return results;
}

function shouldSearch(info, result) {
  const data = result.data;
  const years = result.years || [];
  if (/(搜索|搜一下|查一下|网上|最新|今年|2026)/.test(info.text)) return true;
  if (years.length === 0 || !years.some(y => data?.byYear[y]?.rank)) return true;
  if (info.university && data?.universityData === null) return true;
  if (info.university && data?.universityData?.records?.length < 5) return true;
  return false;
}

function buildSearchQuery(info) {
  if (info.university) {
    return (info.university + ' ' + (info.province || '') + ' ' + (info.major || '') + ' 录取分数线 位次').trim();
  }
  const parts = [info.province || '', '高考'];
  if (info.score) parts.push(info.score + '分');
  if (info.classify) parts.push(info.classify);
  parts.push('志愿填报建议 录取');
  return parts.filter(Boolean).join(' ');
}

// ====== AI 系统提示 ======

function buildSystemPrompt() {
  return [
    '你是一个高考志愿填报助手。基于下面提供的真实数据，帮考生理解自己的分数在志愿填报中处于什么位置。',
    '',
    '## 核心原则（必须遵守）',
    '1. **优先使用「本地数据」中的内容回答**，这些是官方考试院发布的一分一段表。',
    '2. **每条数据必须标注年份和省份**。',
    '3. **禁止承诺录取**，不能说"一定能上""稳了""肯定能录取"等。',
    '4. 如果数据不足以回答，就说「目前数据不足以给出这个建议」。',
    '5. 如果提供了目标大学但没有该校数据，必须明确说「暂无该校录取数据」。',
    '6. **所有内容仅供用户参考，不能替用户做决定**。',
    '',
    '## 关于年份的表述（重要）',
    '- **本地数据均为历史年份**（当前最新为 2025 年），不是用户的考试年份。',
    '- **禁止说"今年""你的年份""当（那）年"**，统一使用具体年份如「2025年」「2023年」，或整体表述为「参考近三年（2023-2025年）历史数据」。',
    '- 示例正确表述：**"根据2025年广东物理类一分一段表，600分对应位次26988"**',
    '- 示例错误表述：❌ "你今年考了600分"  ❌ "你在2025年排在…"',
    '',
    '## 关于「搜索结果」',
    '- 搜索结果来自网络，仅作**参考补充**，**准确性无法保证**，须提醒用户核实。',
    '- 标注每条搜索结果的来源网址。',
    '- 本地数据与搜索结果冲突时，以本地数据为准。',
    '',
    '## 输出要求',
    '- 语言通俗易懂，面向高中生和家长',
    '- 用 **加粗** 标出关键数字',
    '- 分段清晰，每段一个小主题',
    '- **禁止使用 Markdown 标题（#、##、###）**，改用 **序号 1. 2. 3.** 或「关键词加粗」来分层',
    '- 优先展示**多年趋势对比**，让用户看到位次变化',
    '- 如果历史年份的选科名称与当前不同（如老高考"理科"对应新高考"物理"），需向用户说明这是高考改革导致的命名差异，位次仍可参考',
    '- 末尾固定加：⚠️ 以上分析基于历史数据，仅供参考。最终填报请结合官方招生计划和个人情况综合判断。',
  ].join('\n');
}

async function buildAiPromptWithSearch(info, data, years, webResults) {
  const prompt = await buildAiPrompt(info, data, years);

  if (webResults.length > 0) {
    const searchLines = ['', '## 搜索结果（来自网络，仅供参考）'];
    for (const r of webResults) {
      searchLines.push(`- [${r.title}](${r.url})`);
      if (r.snippet) searchLines.push(`  ${r.snippet}`);
    }
    searchLines.push('');
    searchLines.push('注意：搜索结果来自网络，准确性无法保证。与本地数据冲突时以本地数据为准。');
    return prompt + '\n' + searchLines.join('\n');
  }

  return prompt;
}

// ====== AI 流式输出 ======

/**
 * 调用 AI 流式 API，返回 DeepSeek/OpenAI 兼容的 SSE 流（ReadableStream）
 */
async function createAIStream(apiKey, apiUrl, apiModel, systemPrompt, userPrompt, history) {
  const resp = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: apiModel,
      messages: [
        { role: 'system', content: systemPrompt },
        ...history.slice(-6),
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.3,
      max_tokens: 2500,
      stream: true,
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!resp.ok || !resp.body) return null;
  return resp.body;
}

/**
 * 将 AI 的 SSE 流（data: {...}）解析为纯文本 ReadableStream，逐字输出
 */
function parseSSEToText(aiBody) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      const reader = aiBody.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            // 处理残余 buffer
            for (const line of buffer.split('\n')) {
              if (line.startsWith('data: ')) {
                const data = line.slice(6).trim();
                if (data === '[DONE]') continue;
                try {
                  const parsed = JSON.parse(data);
                  const content = parsed.choices?.[0]?.delta?.content || '';
                  if (content) controller.enqueue(encoder.encode(content));
                } catch (_) { /* 跳过格式异常行 */ }
              }
            }
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || ''; // 留不完整的行到下次

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6).trim();
              if (data === '[DONE]') continue;
              try {
                const parsed = JSON.parse(data);
                const content = parsed.choices?.[0]?.delta?.content || '';
                if (content) controller.enqueue(encoder.encode(content));
              } catch (_) { /* 跳过格式异常行 */ }
            }
          }
        }
      } catch (err) {
        console.error('[chat stream] read error:', err.message);
      } finally {
        controller.close();
      }
    },
  });
}

// ====== POST 主路由 ======

export async function POST(request) {
  try {
    // === 积分检查（管理员不扣费） ===
    const session = await auth()
    if (!session?.user?.id) {
      return Response.json({ reply: '请先登录', complete: false }, { status: 401 })
    }
    let creditResult = null
    if (session.user.role !== 'admin') {
      creditResult = await consumeCredit(session.user.id)
      if (!creditResult.ok) {
        return Response.json({
          reply: '❌ ' + (creditResult.message || '积分不足'),
          complete: false,
          credits: creditResult.credits,
        })
      }
    }

    const { text, history = [], stream = false } = await request.json();
    if (!text || !text.trim()) {
      return Response.json({ reply: '请说说你的高考情况，我来帮你分析。', complete: false });
    }

    // 使用共享查询模块
    const result = await queryAndReply(text, history);

    if (!result.complete) {
      return Response.json({ reply: result.reply, complete: false, collected: result.info });
    }

    const { info, years, data } = result;

    // 在线搜索
    let webResults = [];
    if (shouldSearch(info, result)) {
      const searchQuery = buildSearchQuery(info);
      webResults = await searchWeb(searchQuery);
    }

    // ====== AI 模型调用（管理员后台配置） ======
    // 从数据库获取启用的模型配置，若无则回退到环境变量
    let modelConfig = null
    try {
      const enabledModels = await getEnabledModels()
      if (enabledModels?.length > 0) {
        modelConfig = enabledModels[0]
      }
    } catch (_) {}

    const apiKey = modelConfig?.api_key || process.env.DEEPSEEK_API_KEY
    const apiUrl = modelConfig?.api_url || 'https://api.deepseek.com/v1/chat/completions'
    const apiModel = modelConfig?.model_id || process.env.DEEPSEEK_MODEL || 'deepseek-chat'

    if (apiKey && apiKey !== 'sk-your-key-here') {
      const systemPrompt = buildSystemPrompt();
      const userPrompt = await buildAiPromptWithSearch(info, data, years, webResults);

      // ===== 流式路径 =====
      if (stream) {
        const aiBody = await createAIStream(apiKey, apiUrl, apiModel, systemPrompt, userPrompt, history);
        if (aiBody) {
          const textStream = parseSSEToText(aiBody);
          return new Response(textStream, {
            headers: {
              'Content-Type': 'text/plain; charset=utf-8',
              'X-Credits': String(creditResult?.credits ?? ''),
              'X-Complete': 'true',
            },
          });
        }
        // 流式失败 → 降级到非流式
      }

      // ===== 非流式路径（原有逻辑） =====
      try {
        const resp = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: apiModel,
            messages: [
              { role: 'system', content: systemPrompt },
              ...history.slice(-6),
              { role: 'user', content: userPrompt },
            ],
            temperature: 0.3,
            max_tokens: 2500,
          }),
          signal: AbortSignal.timeout(30000),
        });
        if (resp.ok) {
          const json = await resp.json();
          const reply = json.choices?.[0]?.message?.content;
          if (reply) return Response.json({ reply, complete: true, collected: { ...info, years }, credits: creditResult?.credits ?? 0 });
        }
      } catch (_) {}
    }

    // 降级：纯数据回复
    const fallback = buildFallbackReply(info, data, years);
    return Response.json({ reply: fallback.fullText, complete: true, collected: { ...info, years }, credits: creditResult?.credits ?? 0 });

  } catch (e) {
    return Response.json({ reply: '抱歉，处理出错了，请重试。', error: e.message, complete: false });
  }
}
