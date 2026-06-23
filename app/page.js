'use client';

import { useState } from 'react';

const styles = {
  header: { background: 'linear-gradient(135deg, #1e40af 0%, #3b82f6 100%)', color: '#fff', padding: '24px 16px', textAlign: 'center' },
  h1: { fontSize: 22, fontWeight: 700, marginBottom: 4 },
  p: { fontSize: 13, opacity: .85 },
  container: { maxWidth: 640, margin: '0 auto', padding: 16 },
  footer: { textAlign: 'center', padding: '24px 16px', fontSize: 12, color: '#94a3b8' },
  note: { marginTop: 8, padding: 12, background: '#fef9e7', borderRadius: 8, fontSize: 12, color: '#92400e' },
  chatCard: { display: 'flex', flexDirection: 'column', background: '#fff', borderRadius: 12, boxShadow: '0 1px 3px rgba(0,0,0,.08)', padding: 20, marginBottom: 16, height: 520 },
  chatMessages: { flex: 1, overflowY: 'auto', padding: '8px 4px', display: 'flex', flexDirection: 'column', gap: 12 },
  chatMsgRow: (role) => ({ display: 'flex', justifyContent: role === 'user' ? 'flex-end' : 'flex-start', marginBottom: 4 }),
  chatBubble: (role) => ({
    maxWidth: '85%', padding: '10px 14px', borderRadius: 12, fontSize: 14, lineHeight: 1.7, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
    background: role === 'user' ? '#3b82f6' : '#f1f5f9',
    color: role === 'user' ? '#fff' : '#1e293b',
    borderBottomRightRadius: role === 'user' ? 4 : 12,
    borderBottomLeftRadius: role === 'user' ? 12 : 4,
  }),
  chatInputRow: { display: 'flex', gap: 8, borderTop: '1px solid #e2e8f0', paddingTop: 12, marginTop: 8 },
  chatInput: { flex: 1, padding: '10px 14px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 15, outline: 'none' },
  chatSendBtn: { padding: '10px 20px', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 8, fontSize: 15, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' },
  chatLoading: { textAlign: 'center', padding: 8, color: '#94a3b8', fontSize: 13 },
};

export default function Page() {
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [chatLoading, setChatLoading] = useState(false);

  async function handleSend() {
    if (!inputText.trim() || chatLoading) return;
    const userMsg = inputText.trim();
    setInputText('');
    setMessages(prev => [...prev, { role: 'user', content: userMsg }]);
    setChatLoading(true);
    try {
      const history = messages.map(m => ({ role: m.role, content: m.content }));
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: userMsg, history }),
      });
      const data = await res.json();
      setMessages(prev => [...prev, { role: 'assistant', content: data.reply || '抱歉，没有获取到回复。' }]);
    } catch(e) {
      setMessages(prev => [...prev, { role: 'assistant', content: '抱歉，网络错误，请重试。' }]);
    } finally {
      setChatLoading(false);
    }
  }

  return (
    <>
      <div style={styles.header}>
        <div style={styles.h1}>📊 高考志愿 AI 助手</div>
        <div style={styles.p}>输入你的高考情况，AI 自动分析位次、竞争和志愿建议</div>
      </div>
      <div style={styles.container}>
        <div style={styles.chatCard}>
          <h2 style={{ fontSize: 17, margin: '0 0 8px' }}>💬 AI 志愿分析</h2>
          <p style={{ fontSize: 13, color: '#64748b', marginBottom: 8 }}>直接输入你的高考情况，AI 自动分析位次、竞争和录取概率。</p>
          <div style={styles.chatMessages}>
            {messages.length === 0 && (
              <div style={{ textAlign: 'center', color: '#94a3b8', fontSize: 14, padding: 40 }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>🎯</div>
                <div>试试这样输入：</div>
                <div style={{ marginTop: 8, lineHeight: 2, color: '#64748b' }}>
                  「我考了600分，广东物理类」<br />
                  「我考了550分，想去北京」<br />
                  「我考了620分，浙江的，想学计算机」
                </div>
              </div>
            )}
            {messages.map((msg, i) => (
              <div key={i} style={styles.chatMsgRow(msg.role)}>
                <div style={styles.chatBubble(msg.role)}
                  dangerouslySetInnerHTML={{
                    __html: msg.role === 'user'
                      ? msg.content
                      : msg.content.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>')
                  }}
                />
              </div>
            ))}
            {chatLoading && <div style={styles.chatLoading}>🤔 正在查询数据并分析...</div>}
          </div>
          <div style={styles.chatInputRow}>
            <input style={styles.chatInput} type="text" placeholder="输入你的高考情况..." value={inputText}
              onChange={e => setInputText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleSend(); }}
              disabled={chatLoading}
            />
            <button style={{...styles.chatSendBtn, opacity: chatLoading ? 0.6 : 1}}
              onClick={handleSend} disabled={chatLoading}>发送</button>
          </div>
        </div>
      </div>
      <div style={styles.footer}>
        <p>数据来源：各省教育考试院公布的一分一段表</p>
        <div style={styles.note}>⚠️ 所有结果基于历史数据估算，<strong>不构成录取承诺</strong>。填报志愿请结合官方招生计划和个人情况综合判断。</div>
      </div>
    </>
  );
}
