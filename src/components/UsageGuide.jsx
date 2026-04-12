import React, { useState, useEffect } from 'react'
import './UsageGuide.css'
import { GuideInfoIcon } from './Icons/ActionIcons'

export default function UsageGuide ({ platform, title, description, permissions = [], network = [] }) {
  const [isExpanded, setIsExpanded] = useState(() => {
    // 默认折叠，除非用户手动展开过
    try {
      const saved = window.utools
        ? window.utools.dbStorage.getItem(`aideck_guide_expanded_${platform}`)
        : localStorage.getItem(`aideck_guide_expanded_${platform}`)
      return saved === 'true'
    } catch (e) {
      return false
    }
  })

  const toggleExpand = () => {
    const nextState = !isExpanded
    setIsExpanded(nextState)
    try {
      if (window.utools) {
        window.utools.dbStorage.setItem(`aideck_guide_expanded_${platform}`, String(nextState))
      } else {
        localStorage.setItem(`aideck_guide_expanded_${platform}`, String(nextState))
      }
    } catch (e) {}
  }

  return (
    <div className={`usage-guide-container ${isExpanded ? 'is-expanded' : ''}`}>
      <div className='usage-guide-header' onClick={toggleExpand}>
        <div className='usage-guide-header-left'>
          <GuideInfoIcon size={18} className='usage-guide-info-icon-new' />
          <span className='usage-guide-title'>{title || `${platform} 账号管理说明`}</span>
          <span className='usage-guide-hint'>（点击展开/收起）</span>
        </div>
        <div className='usage-guide-chevron'>
          <svg
            viewBox="0 0 24 24"
            width="20"
            height="20"
            stroke="currentColor"
            strokeWidth="2"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={isExpanded ? 'rotate-180' : ''}
          >
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
        </div>
      </div>
      
      {isExpanded && (
        <div className='usage-guide-content'>
          <p className='usage-guide-desc'>{description}</p>
          <ul className='usage-guide-list'>
            {permissions && permissions.length > 0 && (
              <li>
                <strong>权限范围：</strong> 
                {permissions.length === 1 ? permissions[0] : (
                  <ul className='usage-guide-sublist'>
                    {permissions.map((p, idx) => <li key={idx}>{p}</li>)}
                  </ul>
                )}
              </li>
            )}
            {network && network.length > 0 && (
              <li>
                <strong>网络请求范围：</strong>
                {network.length === 1 ? network[0] : (
                  <ul className='usage-guide-sublist'>
                    {network.map((n, idx) => <li key={idx}>{n}</li>)}
                  </ul>
                )}
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  )
}
