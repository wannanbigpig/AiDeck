import { useEffect, useState } from 'react'
import { readSharedSetting, writeSharedSetting } from '../../utils/hostBridge.js'

function ToggleSwitch ({ checked, onChange }) {
  return (
    <label style={{ position: 'relative', display: 'inline-block', width: 42, height: 24, flexShrink: 0 }}>
      <input type='checkbox' checked={checked} onChange={onChange} style={{ opacity: 0, width: 0, height: 0 }} />
      <span style={{ position: 'absolute', inset: 0, cursor: 'pointer', backgroundColor: checked ? 'var(--accent-blue)' : 'var(--border-muted)', transition: '.2s', borderRadius: 999 }}>
        <span style={{ position: 'absolute', height: 18, width: 18, left: 3, bottom: 3, backgroundColor: '#fff', transition: '.2s', borderRadius: '50%', boxShadow: 'var(--shadow-sm)', transform: checked ? 'translateX(18px)' : 'translateX(0)' }} />
      </span>
    </label>
  )
}

export default function SettingsGeneral ({ globalSettings, onGlobalSettingsChange }) {
  const [yellow, setYellow] = useState(20)
  const [green, setGreen] = useState(60)
  const requestLogEnabled = globalSettings?.requestLogEnabled === true

  useEffect(() => {
    const saved = readSharedSetting('aideck_quota_thresholds', null)
    if (saved) {
      setYellow(saved.yellow || 20)
      setGreen(saved.green || 60)
    }
  }, [])

  const saveThresholds = (nextYellow, nextGreen) => {
    writeSharedSetting('aideck_quota_thresholds', { yellow: nextYellow, green: nextGreen })
  }

  const handleYellowChange = (value) => {
    let next = Number(value)
    if (next >= green) next = green - 1
    if (next < 0) next = 0
    setYellow(next)
    saveThresholds(next, green)
  }

  const handleGreenChange = (value) => {
    let next = Number(value)
    if (next <= yellow) next = yellow + 1
    if (next > 100) next = 100
    setGreen(next)
    saveThresholds(yellow, next)
  }

  return (
    <div className='settings-panel'>
      <h2 className='settings-h2'>常规</h2>

      <div className='settings-card' style={{ marginBottom: 16 }}>
        <div className='settings-card-row'>
          <div className='settings-card-info'>
            <div className='settings-card-title'>查看操作日志</div>
            <div className='settings-card-desc'>
              默认关闭。开启后记录插件对外的操作日志和各个关键节点日，并在首页侧边栏设置上方显示“日志”入口。日志完全保留在本地，敏感内容会自动脱敏。
            </div>
          </div>
          <div className='settings-card-control'>
            <ToggleSwitch
              checked={requestLogEnabled}
              onChange={(e) => onGlobalSettingsChange?.({ requestLogEnabled: e.target.checked })}
            />
          </div>
        </div>
      </div>

      <div className='settings-card' style={{ display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '10px 24px', borderBottom: '1px solid var(--border-default)', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>配额颜色阈值</div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>控制绿色、黄色和红色的显示区间。</div>
        </div>

        <div style={{ padding: '10px 24px 20px' }}>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 20, lineHeight: 1.6 }}>
            <div>
              <span style={{ display: 'inline-block', width: 60, color: 'var(--text-muted)' }}>黄色起点</span>
              剩余配额大于等于 <span style={{ fontWeight: 600, fontSize: 16, color: 'var(--text-primary)' }}>{yellow}%</span> 且低于绿色阈值时显示黄色。
            </div>
            <div style={{ marginTop: 4 }}>
              <span style={{ display: 'inline-block', width: 60, color: 'var(--text-muted)' }}>绿色起点</span>
              剩余配额大于等于 <span style={{ fontWeight: 600, fontSize: 16, color: 'var(--text-primary)' }}>{green}%</span> 时显示绿色。
            </div>
          </div>

          <div style={{ position: 'relative', height: 24, display: 'flex', alignItems: 'center', marginBottom: 8 }}>
            <div style={{ position: 'absolute', left: 0, right: 0, height: 6, background: 'var(--border-muted)', borderRadius: 3 }} />
            <div style={{ position: 'absolute', left: 0, width: `${yellow}%`, height: 6, background: 'var(--accent-red)', borderRadius: '3px 0 0 3px' }} />
            <div style={{ position: 'absolute', left: `${yellow}%`, width: `${green - yellow}%`, height: 6, background: 'var(--accent-orange)' }} />
            <div style={{ position: 'absolute', left: `${green}%`, right: 0, height: 6, background: 'var(--accent-green)', borderRadius: '0 3px 3px 0' }} />

            <input type='range' min='0' max='100' value={yellow} onChange={e => handleYellowChange(e.target.value)} className='thumb-slider thumb-yellow' style={{ zIndex: 10 }} />
            <input type='range' min='0' max='100' value={green} onChange={e => handleGreenChange(e.target.value)} className='thumb-slider thumb-green' style={{ zIndex: 11 }} />
          </div>

          <div style={{ position: 'relative', height: 16, fontSize: 12, color: 'var(--text-muted)' }}>
            <span style={{ position: 'absolute', left: 0 }}>0%</span>
            <span style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)' }}>50%</span>
            <span style={{ position: 'absolute', right: 0 }}>100%</span>
          </div>
        </div>
      </div>
    </div>
  )
}
