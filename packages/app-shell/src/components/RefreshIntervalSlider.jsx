import React from 'react'
import {
  AUTO_REFRESH_MINUTE_MARKS,
  AUTO_REFRESH_MINUTES_MAX,
  AUTO_REFRESH_MINUTES_MIN,
  normalizeRefreshIntervalMinutes
} from '../utils/refreshInterval'

export default function RefreshIntervalSlider ({
  value,
  onChange,
  marks = AUTO_REFRESH_MINUTE_MARKS,
  accentColor = 'var(--accent-blue)'
}) {
  const activeValue = normalizeRefreshIntervalMinutes(value, 10) || AUTO_REFRESH_MINUTES_MIN
  const fillPercent = ((activeValue - AUTO_REFRESH_MINUTES_MIN) / (AUTO_REFRESH_MINUTES_MAX - AUTO_REFRESH_MINUTES_MIN)) * 100

  const handleSliderChange = (nextValue) => {
    const normalized = normalizeRefreshIntervalMinutes(nextValue, activeValue) || AUTO_REFRESH_MINUTES_MIN
    onChange?.(normalized)
  }

  return (
    <div className='refresh-interval-slider-wrap'>
      <div className='refresh-interval-current-row'>
        <div className='refresh-interval-current'>
          {`每 ${activeValue} 分钟自动刷新一次全量账号总配额。`}
        </div>
        <label className='refresh-interval-number'>
          <input
            type='number'
            min={String(AUTO_REFRESH_MINUTES_MIN)}
            max={String(AUTO_REFRESH_MINUTES_MAX)}
            step='1'
            value={activeValue}
            onChange={e => handleSliderChange(e.target.value)}
          />
          <span>分钟</span>
        </label>
      </div>
      <input
        type='range'
        min={String(AUTO_REFRESH_MINUTES_MIN)}
        max={String(AUTO_REFRESH_MINUTES_MAX)}
        step='1'
        value={activeValue}
        onChange={e => handleSliderChange(e.target.value)}
        className='refresh-interval-slider'
        style={{
          '--refresh-fill': `${fillPercent}%`,
          '--refresh-accent': accentColor
        }}
      />
      <div className='refresh-interval-marks'>
        {marks.map((item) => (
          <span key={item} className={item === activeValue ? 'is-active' : ''}>
            {item} 分钟
          </span>
        ))}
      </div>
    </div>
  )
}
