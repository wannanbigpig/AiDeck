/**
 * InstanceCard — 活跃实例卡片
 *
 * 参考草图：大图标 + 实例名 + 账号名 + 状态 + 控制按钮
 */
export default function InstanceCard ({ platform, account, instanceName, status, onPlay, onPause, onStop }) {
  const platformStyles = {
    antigravity: { icon: 'A', bg: '#388bfd', label: 'Antigravity' },
    codex: { icon: 'C‹›', bg: '#3fb950', label: 'Codex' },
    gemini: { icon: 'G', bg: '#d29922', label: 'Gemini CLI' }
  }

  const ps = platformStyles[platform] || platformStyles.antigravity
  const statusText = status === 'running' ? 'Running' : status === 'paused' ? 'Paused' : 'Stopped'
  const statusClass = status === 'running' ? 'running' : status === 'paused' ? 'paused' : 'stopped'
  const accountName = account?.name || account?.email?.split('@')[0] || 'Unknown'

  return (
    <div className='instance-card'>
      <div className='instance-card-title'>{instanceName}</div>

      <div className='instance-card-icon-wrap'>
        <div
          className='instance-card-icon'
          style={{ backgroundColor: ps.bg + '18', borderColor: ps.bg + '40', color: ps.bg }}
        >
          <span>{ps.icon}</span>
        </div>
      </div>

      <div className='instance-card-account'>{accountName}</div>
      <div className={`instance-card-status ${statusClass}`}>
        <span className={`instance-status-dot ${statusClass}`} />
        <span>{statusText}</span>
      </div>

      <div className='instance-card-controls'>
        <button className='instance-ctrl-btn play' onClick={onPlay} title='启动/切换'>▶</button>
        <button className='instance-ctrl-btn pause' onClick={onPause} title='暂停'>⏸</button>
        <button className='instance-ctrl-btn stop' onClick={onStop} title='停止/移除'>⏹</button>
      </div>
    </div>
  )
}

/**
 * 新建实例占位卡片
 */
export function NewInstanceCard ({ onClick }) {
  return (
    <div className='instance-card instance-card-new' onClick={onClick}>
      <div className='instance-card-new-content'>
        <span className='instance-card-new-icon'>+</span>
        <span className='instance-card-new-text'>New Instance</span>
      </div>
    </div>
  )
}
