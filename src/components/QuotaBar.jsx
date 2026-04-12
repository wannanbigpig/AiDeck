import { getQuotaLevel } from '../utils/format'

/**
 * 配额进度条组件
 * @param {object} props
 * @param {number} props.percentage - 0-100 剩余百分比
 * @param {string} [props.label] - 标签（如 "5h" / "Weekly"）
 * @param {string} [props.resetTime] - 重置时间文本
 * @param {number} [props.requestsLeft] - 剩余次数
 * @param {number} [props.requestsLimit] - 总次数
 */
export default function QuotaBar ({ percentage = 0, label, resetTime, requestsLeft, requestsLimit }) {
  const level = getQuotaLevel(percentage)

  return (
    <div className='quota-wrapper' style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <div className='quota-info' style={{ marginTop: 0 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{label}</span>
        <span className={`quota-percentage ${level}`}>{Math.round(percentage)}%</span>
      </div>
      <div className='quota-bar'>
        <div
          className={`quota-bar-fill ${level}`}
          style={{ width: Math.max(percentage, 2) + '%' }}
        />
      </div>
      <div className='quota-meta' style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, color: 'var(--text-muted)'}}>
        <span>
          {(typeof requestsLeft === 'number' && typeof requestsLimit === 'number') && `${requestsLeft} / ${requestsLimit} 次`}
        </span>
        {resetTime && <span>{resetTime}</span>}
      </div>
    </div>
  )
}
