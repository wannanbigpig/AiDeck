export default function AutoSwitchThresholdSlider ({
  title,
  description,
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  marks = [],
  accent = 'blue'
}) {
  const numericValue = Math.max(min, Math.min(max, Number(value) || 0))
  const trackPercent = max > min ? ((numericValue - min) / (max - min)) * 100 : 0

  return (
    <div className='auto-switch-threshold-card'>
      <div className='auto-switch-threshold-head'>
        <div className='auto-switch-threshold-copy'>
          <div className='auto-switch-threshold-title'>{title}</div>
          {description
            ? <div className='auto-switch-threshold-desc'>{description}</div>
            : null}
        </div>
        <div className='auto-switch-threshold-value'>{numericValue}%</div>
      </div>

      <div className={`auto-switch-threshold-track auto-switch-threshold-track-${accent}`}>
        <div
          className='auto-switch-threshold-progress'
          style={{ width: `${trackPercent}%` }}
        />
        <input
          type='range'
          min={min}
          max={max}
          step={step}
          value={numericValue}
          onChange={(e) => onChange?.(Math.max(min, Math.min(max, Number(e.target.value) || 0)))}
          className={`auto-switch-threshold-range auto-switch-threshold-range-${accent}`}
        />
      </div>

      {Array.isArray(marks) && marks.length > 0
        ? (
          <div className='auto-switch-threshold-marks'>
            {marks.map(mark => (
              <span key={mark.value}>{mark.label}</span>
            ))}
          </div>
          )
        : null}
    </div>
  )
}
