import React from 'react'
import {
  AUTO_REFRESH_MINUTE_OPTIONS,
  normalizeRefreshIntervalMinutes
} from '../utils/refreshInterval'

export default function RefreshIntervalSlider ({
  value,
  onChange,
  options = AUTO_REFRESH_MINUTE_OPTIONS,
  accentColor = 'var(--accent-blue)'
}) {
  const activeValue = normalizeRefreshIntervalMinutes(value, options[0] || 10)
  const activeIndex = Math.max(0, options.indexOf(activeValue))
  const fillPercent = options.length > 1 ? (activeIndex / (options.length - 1)) * 100 : 100

  const handleSliderChange = (nextIndex) => {
    const nextValue = options[Math.max(0, Math.min(options.length - 1, Number(nextIndex) || 0))]
    onChange?.(nextValue)
  }

  return (
    <div className='refresh-interval-slider-wrap'>
      <div className='refresh-interval-current'>
        {`每 ${activeValue} 分钟自动刷新一次全量账号总配额。`}
      </div>
      <input
        type='range'
        min='0'
        max={String(Math.max(0, options.length - 1))}
        step='1'
        value={activeIndex}
        onChange={e => handleSliderChange(e.target.value)}
        className='refresh-interval-slider'
        style={{
          '--refresh-fill': `${fillPercent}%`,
          '--refresh-accent': accentColor
        }}
      />
      <div className='refresh-interval-marks'>
        {options.map((item) => (
          <span key={item} className={item === activeValue ? 'is-active' : ''}>
            {item} 分钟
          </span>
        ))}
      </div>
    </div>
  )
}
