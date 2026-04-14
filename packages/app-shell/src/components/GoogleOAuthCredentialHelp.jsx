import React from 'react'

export default function GoogleOAuthCredentialHelp ({ platformName, redirectUris = [] }) {
  const items = Array.isArray(redirectUris)
    ? redirectUris.map(item => String(item || '').trim()).filter(Boolean)
    : []

  return (
    <div className="settings-help-card">
      <div className="settings-help-title">不知道怎么获取？按下面步骤操作</div>
      <div className="settings-desc">
        这两个值来自 Google Cloud Console 里你自己创建的 OAuth Client，不是账号页面自动返回的。
      </div>

      <ol className="settings-help-list">
        <li>打开 <a href="https://console.cloud.google.com/auth/clients" target="_blank" rel="noreferrer">Google Cloud Console 的 OAuth Clients 页面</a>，先选择或新建一个 Project。</li>
        <li>如果系统要求先配置同意屏幕，先完成 Branding / OAuth consent screen，并把你自己的 Google 账号加入测试用户。</li>
        <li>点击 Create Client，应用类型选择 <strong>Web application</strong>。</li>
        <li>在 Authorized redirect URIs 里添加 {platformName} 的回调地址：</li>
      </ol>

      <div className="settings-help-code-list">
        {items.map(item => (
          <code key={item} className="settings-help-code">{item}</code>
        ))}
      </div>

      <div className="settings-desc" style={{ marginTop: 10 }}>
        如果实际授权弹窗里显示的回调端口和上面不一致，以弹窗里显示的实际回调地址为准，再补到 Google Cloud 里。
      </div>

      <ol className="settings-help-list" start={5}>
        <li>创建完成后，Google 会显示 <strong>Client ID</strong> 和 <strong>Client Secret</strong>。</li>
        <li>把这两个值复制回当前 {platformName} 设置页即可。</li>
      </ol>
    </div>
  )
}
