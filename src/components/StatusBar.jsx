/**
 * StatusBar — 底部状态栏
 *
 * 参考草图底部: Platforms: 3 | Accounts: 5 | Instances: 3 (2 Running)
 */
export default function StatusBar ({ stats, lastActivity, onQuickInstance }) {
  const { platforms = 0, accounts = 0, instances = 0, running = 0 } = stats || {}

  return (
    <div className='status-bar'>
      <div className='status-bar-stats'>
        <span>Platforms: <b>{platforms}</b></span>
        <span className='status-bar-sep'></span>
        <span>Accounts: <b>{accounts}</b></span>
        <span className='status-bar-sep'></span>
        <span>Instances: <b>{instances}</b>{running > 0 ? ` (${running} Running)` : ''}</span>
      </div>

      {onQuickInstance && (
        <button className='btn btn-sm status-bar-quick' onClick={onQuickInstance}>
          + Quick Instance
        </button>
      )}
    </div>
  )
}
