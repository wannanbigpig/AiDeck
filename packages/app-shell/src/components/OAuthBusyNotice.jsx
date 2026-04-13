export default function OAuthBusyNotice ({
  busy,
  text = '已收到回调，正在添加账号并刷新首轮配额...'
}) {
  if (!busy) return null
  return <div className='oauth-info'>{text}</div>
}
