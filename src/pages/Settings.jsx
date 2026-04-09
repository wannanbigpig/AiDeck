import { useState, useEffect } from 'react'
import { useTheme } from '../components/ThemeToggle'
import { useToast } from '../components/Toast'

const ThemeLightIcon = () => (
  <svg viewBox="0 0 1024 1024" width="14" height="14" fill="currentColor">
    <path d="M554.794667 868.266667v75.946666a37.12 37.12 0 1 1-74.197334 0v-75.946666a37.12 37.12 0 1 1 74.197334 0z m-260.010667-77.482667l-52.48 53.077333a36.864 36.864 0 0 1-52.437333 0 37.802667 37.802667 0 0 1 0-53.12l52.48-53.077333a36.864 36.864 0 0 1 52.437333 0c14.506667 14.72 14.506667 38.4 0 53.12z m550.741333 53.077333a36.864 36.864 0 0 1-52.437333 0l-52.48-53.077333a37.76 37.76 0 0 1 0-53.12 36.864 36.864 0 0 1 52.48 0l52.48 53.12c14.506667 14.677333 14.506667 38.4 0 53.077333zM517.717333 267.946667c133.12 0 241.066667 109.226667 241.066667 244.053333 0 134.826667-107.946667 244.053333-241.066667 244.053333-133.162667 0-241.066667-109.226667-241.066666-244.053333 0-134.826667 107.904-244.053333 241.066666-244.053333z m0 75.093333a166.528 166.528 0 0 0-144.554666 84.48 170.752 170.752 0 0 0 0 168.96 166.528 166.528 0 0 0 144.554666 84.48c92.16 0 166.912-75.648 166.912-168.96 0-93.312-74.752-168.96-166.912-168.96zM981.333333 512a37.546667 37.546667 0 0 1-37.546666 37.546667h-73.258667a37.546667 37.546667 0 0 1 0-75.093334h73.258667A37.546667 37.546667 0 0 1 981.333333 512zM202.453333 512a37.546667 37.546667 0 0 1-37.546666 37.546667H91.605333a37.546667 37.546667 0 1 1 0-75.093334h73.301334a37.546667 37.546667 0 0 1 37.546666 37.546667z m645.888-281.6l-52.437333 53.12a36.864 36.864 0 0 1-52.48 0 37.802667 37.802667 0 0 1 0-53.12l52.48-53.077333a36.864 36.864 0 0 1 52.48 0c14.506667 14.677333 14.506667 38.4 0 53.077333zM291.968 283.52a36.864 36.864 0 0 1-52.437333 0L187.050667 230.4a37.802667 37.802667 0 0 1 0-53.12 36.821333 36.821333 0 0 1 52.48 0L291.968 230.4c14.506667 14.72 14.506667 38.4 0 53.12z m262.826667-203.776v76.032a37.12 37.12 0 1 1-74.197334 0V79.744a37.12 37.12 0 1 1 74.197334 0z"></path>
  </svg>
)

const ThemeDarkIcon = () => (
  <svg viewBox="0 0 1024 1024" width="14" height="14" fill="currentColor">
    <path d="M512 964c-249.24 0-452-202.76-452-452 0-114.48 42.88-223.72 120.76-307.56 77.44-83.36 182.4-134.2 295.44-143.04a36.04 36.04 0 0 1 34.32 18.48 36 36 0 0 1-2.6 38.88C471.32 167.96 452 226.48 452 288c0 156.6 127.4 284 284 284 61.48 0 120-19.32 169.24-55.92a36 36 0 0 1 38.88-2.6 36.04 36.04 0 0 1 18.48 34.32c-8.88 113.08-59.68 218-143.04 295.44C735.72 921.12 626.52 964 512 964zM409.36 146.12C249.12 191.36 132 340 132 512c0 209.52 170.48 380 380 380 172 0 320.64-117.08 365.88-277.36-44.36 19.32-92.36 29.36-141.88 29.36-196.28 0-356-159.72-356-356 0-49.52 10-97.52 29.36-141.88z"></path>
  </svg>
)

const ThemeAutoIcon = () => (
  <svg viewBox="0 0 1621 1024" width="18" height="12" fill="currentColor">
    <path d="M1373.051 850.88l0-738.881c0-27.651-20.606-49.999-46.066-49.999l-1025.171 0c-25.455 0-46.066 22.348-46.066 49.999l0 738.881-151.082 0 0 61.123c0 27.647 20.64 49.997 46.066 49.997l1332.364 0c25.45 0 46.091-22.348 46.091-49.997l0-61.123-156.136 0zM911.28 871.869l-188.711 0 0-32.449 188.711 0 0 32.449zM1278.267 790.137l-927.706 0 0-625.057 927.706 0 0 625.057zM1278.267 790.137z"></path>
  </svg>
)

function ThemeCapsule () {
  const { theme, setTheme } = useTheme()

  const options = [
    { value: 'light', icon: <ThemeLightIcon />, label: '浅色' },
    { value: 'dark', icon: <ThemeDarkIcon />, label: '深色' },
    { value: 'auto', icon: <ThemeAutoIcon />, label: '系统' }
  ]

  return (
    <div className='settings-theme-switcher'>
      {options.map(opt => (
        <button
          key={opt.value}
          className={`settings-theme-btn ${theme === opt.value ? 'active' : ''}`}
          onClick={() => setTheme(opt.value)}
          title={opt.label}
        >
          <span className="settings-theme-icon">{opt.icon}</span>
          <span>{opt.label}</span>
        </button>
      ))}
    </div>
  )
}

function SettingsAppearance() {
  return (
    <div className='settings-panel'>
      <h2 className='settings-h2'>外观</h2>
      <div className='settings-card'>
        <div className='settings-card-row'>
          <div className='settings-card-info'>
            <div className='settings-card-title'>主题</div>
            <div className='settings-card-desc'>使用浅色、深色，或匹配系统设置</div>
          </div>
          <div className='settings-card-control'>
            <ThemeCapsule />
          </div>
        </div>
      </div>
    </div>
  )
}

function SettingsGeneral() {
  const [yellow, setYellow] = useState(20)
  const [green, setGreen] = useState(60)

  useEffect(() => {
    let saved = null
    try {
      if (window.utools) {
        saved = window.utools.dbStorage.getItem('aideck_quota_thresholds')
      } else {
        const s = localStorage.getItem('aideck_quota_thresholds')
        if (s) saved = JSON.parse(s)
      }
    } catch(e){}
    if (saved) {
      setYellow(saved.yellow || 20)
      setGreen(saved.green || 60)
    }
  }, [])

  const handleSave = (y, g) => {
    const data = { yellow: y, green: g }
    if (window.utools) {
      window.utools.dbStorage.setItem('aideck_quota_thresholds', data)
    } else {
      localStorage.setItem('aideck_quota_thresholds', JSON.stringify(data))
    }
  }

  const handleYellowChange = (val) => {
    let newVal = Number(val)
    if (newVal >= green) newVal = green - 1
    if (newVal < 0) newVal = 0
    setYellow(newVal)
    handleSave(newVal, green)
  }

  const handleGreenChange = (val) => {
    let newVal = Number(val)
    if (newVal <= yellow) newVal = yellow + 1
    if (newVal > 100) newVal = 100
    setGreen(newVal)
    handleSave(yellow, newVal)
  }

  return (
    <div className='settings-panel'>
      <h2 className='settings-h2'>常规</h2>
      
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
            
            {/* segments */}
            <div style={{ position: 'absolute', left: 0, width: `${yellow}%`, height: 6, background: 'var(--accent-red)', borderRadius: '3px 0 0 3px' }} />
            <div style={{ position: 'absolute', left: `${yellow}%`, width: `${green - yellow}%`, height: 6, background: 'var(--accent-yellow)' }} />
            <div style={{ position: 'absolute', left: `${green}%`, right: 0, height: 6, background: 'var(--accent-green)', borderRadius: '0 3px 3px 0' }} />
            
            {/* thumbs */}
            <input 
              type="range" min="0" max="100" value={yellow} 
              onChange={e => handleYellowChange(e.target.value)}
              className="thumb-slider thumb-yellow"
              style={{ zIndex: 10 }}
            />
            <input 
              type="range" min="0" max="100" value={green} 
              onChange={e => handleGreenChange(e.target.value)}
              className="thumb-slider thumb-green"
              style={{ zIndex: 11 }}
            />
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

function SettingsPersonalize() {
  const [personality, setPersonality] = useState('务实')
  const [instruction, setInstruction] = useState('')
  const toast = useToast()

  useEffect(() => {
    let stored = null
    if (window.utools) {
      stored = window.utools.dbStorage.getItem('ai_custom_instructions')
    } else {
      const s = localStorage.getItem('ai_custom_instructions')
      if (s) {
        try { stored = JSON.parse(s) } catch(e){}
      }
    }
    if (stored) {
      setInstruction(stored.text || '')
      setPersonality(stored.personality || '务实')
    } else {
      setInstruction('# Always respond in 中文\n\n# 毛泽东思想指导下的工程实践\n\n> "没有调查就没有发言权。" —— 编码之前，先读懂代码库。')
    }
  }, [])

  const handleSave = () => {
    const data = { text: instruction, personality }
    if (window.utools) {
      window.utools.dbStorage.setItem('ai_custom_instructions', data)
    } else {
      localStorage.setItem('ai_custom_instructions', JSON.stringify(data))
    }
    toast.success('自定义指令已保存')
  }

  const handleCopy = () => {
    const textToCopy = `[${personality}模式]\n${instruction}`
    if (window.utools) {
      window.utools.copyText(textToCopy)
      toast.success('已复制到剪贴板')
    } else {
      navigator.clipboard.writeText(textToCopy)
      toast.success('已复制到剪贴板')
    }
  }

  return (
    <div className='settings-panel'>
      <h2 className='settings-h2'>个性化</h2>
      <div className='settings-card' style={{ display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 24px', borderBottom: '1px solid var(--border-default)', fontSize: '14px', fontWeight: 500, color: 'var(--text-primary)' }}>
          <span>自定义指令</span>
          <button className='btn btn-sm' onClick={handleCopy} style={{ padding: '4px 8px', fontSize: 12 }}>
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 4, verticalAlign: '-1px' }}>
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
            复制
          </button>
        </div>
        <div style={{ padding: '24px', position: 'relative' }}>
          <textarea
            className='settings-textarea'
            value={instruction}
            onChange={e => setInstruction(e.target.value)}
            spellCheck={false}
          />
          <button className='btn btn-primary' style={{ position: 'absolute', bottom: 40, right: 40 }} onClick={handleSave}>
            保存
          </button>
        </div>
      </div>
    </div>
  )
}

export default function Settings ({ onNavigate }) {
  const [activeTab, setActiveTab] = useState('general')

  const tabs = [
    { id: 'general', label: '常规', icon: 
      <svg viewBox="0 0 1024 1024" width="16" height="16" fill="currentColor"><path d="M511.8 165.1c20 0 40.4 1.7 60.5 5.1 3.5 0.6 7.5 4.3 10.6 9.6 41.8 72.6 120.9 119.7 206.3 123.1 8.5 0.3 13.3 3 14.3 4.3 23.8 31.1 42 65.5 53.9 102.3 1.4 4.3 1.1 7.3 0.8 8-26.1 60.1-26.1 129 0.1 189.1 0.3 0.8 0.6 3.8-0.8 8.1-11.9 36.5-30 70.8-53.9 101.9-1 1.3-5.8 4-14.3 4.3-85.6 3.3-164.8 50.6-206.6 123.3-3 5.3-7.1 9-10.5 9.5-20 3.3-40.3 4.9-60.5 4.9-19.9 0-40.2-1.7-60.3-5-3.5-0.6-7.6-4.3-10.7-9.7C399 771.4 319.9 724.3 234.3 721c-8.5-0.3-13.2-3-14.1-4.2-23.9-31.2-42.1-65.7-54.1-102.7-1.5-4.7-1-7.6-0.8-8.2 26.2-60.4 26.3-129.3 0.2-189.1-0.2-0.5-0.7-3.3 0.9-8 12-36.6 30.1-70.9 53.8-101.9 0.9-1.2 5.6-3.8 13.9-4.1 85.7-3.3 164.9-50.3 206.7-122.8 3.2-5.5 7.3-9.3 10.9-9.9 20.2-3.3 40.3-5 60.1-5m0-69.3c-24.3 0-48.1 2.1-71.3 5.9-26 4.3-46.8 21.4-59.6 43.6-30.4 52.7-87.4 85.8-149.3 88.2-25.9 1-50.9 11.1-66.3 31.2-28.2 36.7-50.2 78-64.8 122.5-6.1 18.7-6.4 39.1 1.5 57.2 18.7 42.8 18.2 91.2-0.3 133.8-7.8 18.1-7.7 38.5-1.6 57.2 14.5 44.9 36.7 86.6 65 123.5 15.5 20.2 40.5 30.3 66.5 31.3 62 2.4 118.8 35.7 149.1 88.3 12.8 22.1 33.5 39.2 59.4 43.5 23.3 3.9 47.2 6 71.7 6 24.4 0 48.4-2 71.7-5.8 25.9-4.2 46.7-21.2 59.4-43.4 30.2-52.6 87-86.2 149.1-88.6 26.1-1 51.1-11.2 66.6-31.4 28.2-36.8 50.4-78.1 64.9-122.7 6.1-18.7 6.3-39.2-1.6-57.3-18.6-42.7-18.6-91-0.1-133.7 7.8-18 7.6-38.4 1.5-57.1-14.5-44.7-36.6-86.2-64.8-123.1-15.5-20.2-40.5-30.4-66.6-31.4-62.1-2.4-118.7-35.9-148.9-88.4-12.7-22.1-33.4-39.1-59.2-43.4-23.4-3.8-47.4-5.9-72-5.9z"></path><path d="M511.8 442.6c41.1 0 74.5 31.1 74.5 69.4s-33.4 69.4-74.5 69.4-74.5-31.1-74.5-69.4 33.5-69.4 74.5-69.4m0-69.4c-79.4 0-143.8 62.1-143.8 138.7s64.4 138.7 143.8 138.7 143.8-62.1 143.8-138.7-64.3-138.7-143.8-138.7z"></path></svg>
    },
    { id: 'appearance', label: '外观', icon: 
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
    },
    { id: 'personalize', label: '个性化', icon: 
      <svg viewBox="0 0 1024 1024" width="16" height="16" fill="currentColor"><path d="M256 917.333333V425.216a149.333333 149.333333 0 1 1 42.666667 0V917.333333a21.333333 21.333333 0 0 1-42.666667 0z m-85.333333-640A106.666667 106.666667 0 1 0 277.333333 170.666667 106.666667 106.666667 0 0 0 170.666667 277.333333z"></path><path d="M277.333333 945.024a27.690667 27.690667 0 0 1-27.733333-27.605333V430.677333a155.776 155.776 0 1 1 55.466667 0V917.333333a27.776 27.776 0 0 1-27.733334 27.690667z m0-810.666667a142.933333 142.933333 0 0 0-20.437333 284.416l5.504 0.768V917.333333a14.976 14.976 0 0 0 29.866667 0V419.669333l5.504-0.768a142.933333 142.933333 0 0 0-20.48-284.416z m0 256a113.066667 113.066667 0 1 1 112.981334-112.981333A113.194667 113.194667 0 0 1 277.333333 390.4z m0-213.333333a100.266667 100.266667 0 1 0 100.181334 100.352A100.437333 100.437333 0 0 0 277.333333 177.066667z"></path><path d="M640 789.333333a149.333333 149.333333 0 0 1 128-147.626666V149.333333a21.333333 21.333333 0 0 1 42.666667 0v492.373334a149.333333 149.333333 0 1 1-170.666667 147.626666z m42.666667 0a106.666667 106.666667 0 1 0 106.666666-106.666666 106.965333 106.965333 0 0 0-106.666666 106.666666z"></path><path d="M789.333333 945.024a155.648 155.648 0 0 1-27.733333-308.864V149.333333a27.776 27.776 0 0 1 55.466667 0v486.826667a155.648 155.648 0 0 1-27.818667 308.864z m0-810.666667a14.848 14.848 0 0 0-14.933333 14.805334v497.92l-5.504 0.768a142.976 142.976 0 1 0 40.917333 0l-5.504-0.768V149.333333a14.933333 14.933333 0 0 0-14.976-14.890666z m0 768a113.066667 113.066667 0 1 1 112.981334-113.152A113.28 113.28 0 0 1 789.333333 902.4z m0-213.333333a100.266667 100.266667 0 1 0 100.181334 100.181333A100.352 100.352 0 0 0 789.333333 689.066667z"></path><path d="M512 917.376v-236.245333a149.333333 149.333333 0 0 1 9.429333-296.704 243.072 243.072 0 0 0-9.429333 0.938666V149.376a21.333333 21.333333 0 0 1 42.666667 0v236.16a169.088 169.088 0 0 0-9.002667-0.896A149.333333 149.333333 0 0 1 554.666667 681.301333v236.074667a21.333333 21.333333 0 0 1-42.666667 0z m21.333333-234.666667z m-4.650666 0z m9.429333 0z m-111.488-149.333333a106.666667 106.666667 0 1 0 106.666667-106.666667 106.666667 106.666667 0 0 0-106.624 106.666667z m95.744-148.949333h2.432z m21.76 0z m-17.066667-0.256h1.749334z m12.8 0z m-9.514666 0z m6.485333 0z"></path><path d="M533.333333 945.066667a27.690667 27.690667 0 0 1-27.733333-27.605334v-230.826666a155.776 155.776 0 0 1 0-306.56V149.376a27.776 27.776 0 0 1 55.466667 0V380.16a155.776 155.776 0 0 1 0 306.56v230.826667a27.776 27.776 0 0 1-27.733334 27.52z m-11.434666-554.154667a142.933333 142.933333 0 0 0-9.002667 283.989333l5.504 0.768v241.706667a14.976 14.976 0 0 0 29.866667 0v-241.792l5.504-0.768a142.933333 142.933333 0 0 0-8.533334-283.946667l0.981334-12.8h2.005333v-228.693333a14.976 14.976 0 0 0-29.866667 0v229.034667h2.517334l0.981333 12.8z m11.434666 255.488a113.066667 113.066667 0 1 1 112.981334-112.981333 113.194667 113.194667 0 0 1-112.981334 112.938666z m0-213.333333a100.266667 100.266667 0 1 0 100.181334 100.352 100.437333 100.437333 0 0 0-100.181334-100.394667z"></path></svg>
    }
  ]

  const renderContent = () => {
    switch (activeTab) {
      case 'general': return <SettingsGeneral />
      case 'personalize': return <SettingsPersonalize />
      case 'appearance':
      default: return <SettingsAppearance />
    }
  }

  return (
    <div className='settings-layout'>
      <div className='settings-sidebar'>
        <div className='settings-back' onClick={() => onNavigate('dashboard')}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
          返回应用
        </div>
        <nav className='settings-nav'>
          {tabs.map(t => (
            <div 
              key={t.id} 
              className={`settings-nav-item ${activeTab === t.id ? 'active' : ''}`}
              onClick={() => setActiveTab(t.id)}
            >
              {t.icon}
              <span>{t.label}</span>
            </div>
          ))}
        </nav>
      </div>
      <div className='settings-content'>
        {renderContent()}
      </div>
    </div>
  )
}
