import React from 'react'

/**
 * 统一的加载旋转图标，常用于按钮内部的正在加载状态
 */
export default function SpinnerBtnIcon() {
  return (
    <svg 
      className="spin-icon" 
      viewBox="0 0 24 24" 
      width="16" 
      height="16" 
      fill="none" 
      stroke="currentColor" 
      strokeWidth="2" 
      strokeLinecap="round" 
      strokeLinejoin="round"
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  )
}
