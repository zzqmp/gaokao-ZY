import './globals.css'
import SessionProvider from '@/components/SessionProvider'
import { auth } from '@/lib/auth'

export const metadata = {
  title: '高考志愿数据查询',
  description: '一分一段表·同位分换算·录取概率估算',
}

export default async function RootLayout({ children }) {
  const session = await auth()

  return (
    <html lang="zh-CN">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      </head>
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased">
        <SessionProvider session={session}>
          {children}
        </SessionProvider>
      </body>
    </html>
  )
}
