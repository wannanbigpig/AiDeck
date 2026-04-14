export default function OAuthBusyNotice ({
  busy,
  text = '已收到回调，正在添加账号并刷新首轮配额...'
}) {
  if (!busy) return null
  return <div className='oauth-info'>{text}</div>
}

export function OAuthRegenNotice () {
  return (
    <div className='oauth-info' style={{ backgroundColor: '#fff7ed', borderColor: '#fed7aa' }}>
      已生成新的授权链接，请使用最新的链接进行授权。旧的授权链接已失效。
    </div>
  )
}
