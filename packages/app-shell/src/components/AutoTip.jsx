import React, { useRef, useState } from 'react'

/**
 * AutoTip 组件：只有当内部文字由于容器宽度限制出现省略号（Overflow）时，才激活 Tooltip 提示。
 * 解决了“不溢出也弹窗”的视觉噪音问题。
 */
export default function AutoTip({ text, children, className = '', style = {} }) {
  const [hasTip, setHasTip] = useState(false)
  const contentRef = useRef(null)

  const handleMouseEnter = () => {
    if (contentRef.current) {
      // 核心检测逻辑：内容实际宽度 vs 容器可是宽度
      const isOverflowing = contentRef.current.scrollWidth > contentRef.current.clientWidth
      setHasTip(isOverflowing)
    }
  }

  return (
    <span 
      className={`account-detail-value ${hasTip ? 'has-tip' : ''} ${className}`}
      data-tip={hasTip ? text : undefined}
      onMouseEnter={handleMouseEnter}
      style={style}
    >
      <span ref={contentRef} className="account-detail-text">
        {children}
      </span>
    </span>
  )
}
