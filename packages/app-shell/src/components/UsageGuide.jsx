import React, { useState, useEffect } from 'react'
import './UsageGuide.css'
import { GuideInfoIcon, ChevronDownIcon } from './Icons/ActionIcons'
import { readHostSetting, writeHostSetting } from '../utils/hostBridge.js'

export default function UsageGuide ({ platform, title, description, permissions = [], network = [] }) {
  const [isExpanded, setIsExpanded] = useState(() => {
    return readHostSetting(`aideck_guide_expanded_${platform}`, false) === true
  })

  const toggleExpand = () => {
    const nextState = !isExpanded
    setIsExpanded(nextState)
    writeHostSetting(`aideck_guide_expanded_${platform}`, nextState)
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
          <ChevronDownIcon 
            size={20} 
            className={isExpanded ? 'rotate-180' : ''} 
            style={{ transition: 'transform 0.2s ease' }}
          />
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
