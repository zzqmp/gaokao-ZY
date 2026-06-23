/**
 * 邮件发送模块
 * 支持 SMTP 协议，通过环境变量配置
 *
 * 环境变量：
 *   MAIL_HOST      — SMTP 服务器（如 smtp.qq.com）
 *   MAIL_PORT      — 端口（465/587）
 *   MAIL_SECURE    — 是否 SSL（true/false，默认 true）
 *   MAIL_USER      — 邮箱账号
 *   MAIL_PASS      — 邮箱密码/授权码
 *   MAIL_FROM      — 发件人地址（默认同 MAIL_USER）
 *   MAIL_FROM_NAME — 发件人名称
 *
 * 如果 MAIL_HOST 未配置，所有邮件将打印到控制台（开发模式）
 */
const config = {
  host: process.env.MAIL_HOST || '',
  port: parseInt(process.env.MAIL_PORT || '465'),
  secure: process.env.MAIL_SECURE !== 'false',
  user: process.env.MAIL_USER || '',
  pass: process.env.MAIL_PASS || '',
  from: process.env.MAIL_FROM || process.env.MAIL_USER || 'noreply@gaokao.local',
  fromName: process.env.MAIL_FROM_NAME || '高考志愿助手',
}

let _transporter = null

async function getTransporter() {
  if (_transporter) return _transporter
  if (!config.host) return null // 无配置时降级为控制台输出
  const nodemailerMod = await import('nodemailer')
  _transporter = nodemailerMod.default.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.pass },
  })
  return _transporter
}

/**
 * 发送邮件
 * @param {{ to: string, subject: string, text: string, html?: string }}
 * @returns {{ ok: boolean, message: string }}
 */
export async function sendMail({ to, subject, text, html }) {
  const transporter = await getTransporter()

  if (!transporter) {
    // 开发模式：打印到控制台
    console.log('═══════════════════════════════════════')
    console.log('📧 [DEV MAIL] To:', to)
    console.log('   Subject:', subject)
    console.log('   Body:')
    console.log(text)
    console.log('═══════════════════════════════════════')
    return { ok: true, message: '开发模式：邮件已输出到控制台' }
  }

  try {
    await transporter.sendMail({
      from: `"${config.fromName}" <${config.from}>`,
      to,
      subject,
      text,
      html: html || text.replace(/\n/g, '<br>'),
    })
    return { ok: true, message: '邮件发送成功' }
  } catch (err) {
    console.error('[mail] send failed:', err)
    return { ok: false, message: '邮件发送失败: ' + (err.message || '') }
  }
}

/**
 * 发送注册欢迎邮件（含密码）
 */
export async function sendRegistrationMail({ to, username, password }) {
  const subject = '🎓 高考志愿助手 - 注册成功'
  const text = [
    '您好！',
    '',
    `您已成功注册高考志愿助手，账号信息如下：`,
    '',
    `用户名：${username}`,
    `密  码：${password}`,
    `邮  箱：${to}`,
    '',
    '登录地址：请访问网站首页 → 登录',
    '',
    '⚠️ 为了账户安全，建议首次登录后修改密码。',
    '每次查询消耗 1 积分，初始赠送 10 积分。',
    '',
    '如有问题请联系管理员。',
    '',
    '—— 高考志愿助手',
  ].join('\n')

  const html = [
    '<div style="max-width:560px;margin:0 auto;font-family:sans-serif;padding:24px">',
    '  <div style="text-align:center;padding:20px 0;font-size:22px;font-weight:bold;color:#1e40af">🎓 高考志愿助手</div>',
    '  <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:24px">',
    '    <p style="font-size:15px;color:#1e293b">您好！</p>',
    '    <p style="font-size:15px;color:#1e293b">您已成功注册高考志愿助手，账号信息如下：</p>',
    '    <table style="width:100%;font-size:14px;margin:16px 0">',
    `      <tr><td style="padding:6px 12px;color:#64748b">用户名</td><td style="padding:6px 12px;font-weight:bold">${username}</td></tr>`,
    `      <tr><td style="padding:6px 12px;color:#64748b">密　码</td><td style="padding:6px 12px;font-weight:bold;font-family:monospace;font-size:16px;color:#dc2626">${password}</td></tr>`,
    `      <tr><td style="padding:6px 12px;color:#64748b">邮　箱</td><td style="padding:6px 12px">${to}</td></tr>`,
    '    </table>',
    '    <p style="font-size:13px;color:#dc2626">⚠️ 建议首次登录后修改密码。每次查询消耗 1 积分。</p>',
    '    <hr style="border:none;border-top:1px solid #e2e8f0;margin:16px 0">',
    '    <p style="font-size:13px;color:#94a3b8">—— 高考志愿助手</p>',
    '  </div>',
    '</div>',
  ].join('\n')

  return sendMail({ to, subject, text, html })
}
