'use client'

import { useState, useEffect, useRef } from 'react'
import { useSession, signOut } from 'next-auth/react'
import { useRouter } from 'next/navigation'

export default function Page() {
  const { data: session, update: updateSession } = useSession()
  const router = useRouter()
  const [messages, setMessages] = useState([])
  const [inputText, setInputText] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const [remainingCredits, setRemainingCredits] = useState(null)
  const [showPwdMenu, setShowPwdMenu] = useState(false)
  const composingRef = useRef(false)

  // 首次登录强制改密
  useEffect(() => {
    if (session?.user?.mustChangePassword) {
      router.push('/change-password')
    }
  }, [session, router])

  async function handleSend() {
    if (!inputText.trim() || chatLoading) return
    const userMsg = inputText.trim()
    setInputText('')
    setMessages(prev => [...prev, { role: 'user', content: userMsg }])
    setChatLoading(true)
    try {
      const history = messages.map(m => ({ role: m.role, content: m.content }))
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: userMsg, history }),
      })
      const data = await res.json()
      if (data.credits !== undefined) setRemainingCredits(data.credits)
      setMessages(prev => [...prev, { role: 'assistant', content: data.reply || '抱歉，没有获取到回复。' }])
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: '抱歉，网络错误，请重试。' }])
    } finally {
      setChatLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* 顶栏 */}
      <header className="bg-gradient-to-r from-blue-700 to-blue-500 text-white px-4 py-3">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold">📊 高考志愿 AI 助手</h1>
            <p className="text-xs text-blue-100">一分一段表 · 同位分换算 · 录取概率估算</p>
          </div>
          {session && (
            <div className="flex items-center gap-2">
              {session.user.role === 'admin' ? (
                <>
                  <span className="text-sm text-blue-100">⚡ 管理员</span>
                  <a href="/admin/users"
                    className="text-xs px-2.5 py-1.5 bg-white/20 hover:bg-white/30 rounded-md transition-colors"
                  >
                    管理
                  </a>
                </>
              ) : (
                <span className="text-sm text-blue-100">💳 {remainingCredits ?? session.user.credits ?? '?'}</span>
              )}

              {/* 用户菜单 */}
              <div className="relative">
                <button
                  onClick={() => setShowPwdMenu(!showPwdMenu)}
                  className="text-xs px-2.5 py-1.5 bg-white/20 hover:bg-white/30 rounded-md transition-colors"
                >
                  {session.user.name} ▾
                </button>
                {showPwdMenu && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setShowPwdMenu(false)} />
                    <div className="absolute right-0 top-full mt-1 z-20 bg-white rounded-lg shadow-lg border border-slate-200 py-1 min-w-[120px]">
                      <a
                        href="/change-password"
                        className="block px-3 py-2 text-xs text-slate-700 hover:bg-slate-50"
                        onClick={() => setShowPwdMenu(false)}
                      >
                        🔐 修改密码
                      </a>
                      <button
                        onClick={() => { setShowPwdMenu(false); signOut({ callbackUrl: '/login' }); }}
                        className="w-full text-left px-3 py-2 text-xs text-red-600 hover:bg-slate-50"
                      >
                        🚪 退出
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </header>

      {/* 主内容 */}
      <main className="flex-1 max-w-3xl mx-auto w-full px-4 py-6">
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 flex flex-col h-[600px]">
          {/* 标题 */}
          <div className="px-5 pt-4 pb-2 border-b border-slate-100">
            <h2 className="font-semibold text-slate-800">💬 AI 志愿分析</h2>
            <p className="text-xs text-slate-500 mt-0.5">直接输入你的高考情况，AI 自动分析位次、竞争和录取概率。</p>
            {remainingCredits !== null && remainingCredits <= 3 && remainingCredits > 0 && (
              <p className="text-xs text-amber-600 mt-1">⚠️ 积分仅剩 <strong>{remainingCredits}</strong> 次，请联系管理员充值</p>
            )}
          </div>

          {/* 消息区 */}
          <div className="flex-1 overflow-y-auto px-5 py-3 space-y-3">
            {messages.length === 0 && (
              <div className="text-center py-12">
                <div className="text-4xl mb-3">🎯</div>
                <p className="text-slate-400 text-sm">试试这样输入：</p>
                <div className="mt-3 space-y-1 text-sm text-slate-500">
                  <p>「我考了600分，广东物理类」</p>
                  <p>「我考了550分，想去北京」</p>
                  <p>「我考了620分，浙江的，想学计算机」</p>
                </div>
              </div>
            )}
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words ${
                    msg.role === 'user'
                      ? 'bg-blue-600 text-white rounded-br-md'
                      : 'bg-slate-100 text-slate-800 rounded-bl-md'
                  }`}
                  dangerouslySetInnerHTML={{
                    __html: msg.role === 'user'
                      ? msg.content
                      : msg.content
                          .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
                          .replace(/\n/g, '<br>')
                  }}
                />
              </div>
            ))}
            {chatLoading && (
              <div className="text-center text-slate-400 text-sm py-2">🤔 正在查询数据并分析...</div>
            )}
          </div>

          {/* 输入区 */}
          <div className="border-t border-slate-100 px-5 py-3">
            <div className="flex gap-2">
              <input
                type="text"
                value={inputText}
                onChange={e => { if (!composingRef.current) setInputText(e.target.value) }}
                onCompositionStart={() => { composingRef.current = true }}
                onCompositionEnd={e => { composingRef.current = false; setInputText(e.target.value) }}
                onKeyDown={e => { if (e.key === 'Enter') handleSend() }}
                disabled={chatLoading}
                className="flex-1 px-4 py-2.5 border border-slate-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-slate-50"
                placeholder="输入你的高考情况..."
              />
              <button
                onClick={handleSend}
                disabled={chatLoading}
                className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-lg text-sm font-medium transition-colors"
              >
                发送
              </button>
            </div>
          </div>
        </div>

        {/* 页脚 */}
        <p className="text-center text-xs text-slate-400 mt-4">
          数据来源：各省教育考试院公布的一分一段表
        </p>
        <div className="mt-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800">
          ⚠️ 所有结果基于历史数据估算，<strong>不构成录取承诺</strong>。填报志愿请结合官方招生计划和个人情况综合判断。
        </div>
      </main>
    </div>
  )
}
