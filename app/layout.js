export const metadata = {
  title: '高考志愿数据查询',
  description: '一分一段表·同位分换算·录取概率估算',
}

export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      </head>
      <body style={{ margin: 0, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif', background: '#f0f4f8', color: '#1a202c', minHeight: '100vh' }}>
        {children}
      </body>
    </html>
  )
}
