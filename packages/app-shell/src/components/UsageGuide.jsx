import { useState } from 'react'
import { createPortal } from 'react-dom'
import './UsageGuide.css'
import { GuideInfoIcon } from './Icons/ActionIcons'
import Modal from './Modal'

export default function UsageGuide ({ platform, title, description, permissions = [], network = [] }) {
  const [open, setOpen] = useState(false)
  const guideTitle = title || `${platform} 账号管理说明`
  const modal = (
    <Modal
      title={guideTitle}
      open={open}
      onClose={() => setOpen(false)}
      contentClassName='usage-guide-modal'
    >
      <div className='usage-guide-content'>
        <p className='usage-guide-desc'>{description}</p>
        <ul className='usage-guide-list'>
          {permissions && permissions.length > 0 && (
            <li>
              <strong>功能与权限：</strong>
              {permissions.length === 1
                ? permissions[0]
                : (
                  <ul className='usage-guide-sublist'>
                    {permissions.map((item, index) => <li key={index}>{item}</li>)}
                  </ul>
                  )}
            </li>
          )}
          {network && network.length > 0 && (
            <li>
              <strong>网络请求范围：</strong>
              {network.length === 1
                ? network[0]
                : (
                  <ul className='usage-guide-sublist'>
                    {network.map((item, index) => <li key={index}>{item}</li>)}
                  </ul>
                  )}
            </li>
          )}
        </ul>
      </div>
    </Modal>
  )

  return (
    <>
      <button
        type='button'
        className='usage-guide-trigger'
        onClick={() => setOpen(true)}
        aria-label={guideTitle}
        data-tip={guideTitle}
      >
        <GuideInfoIcon size={24} />
      </button>
      {typeof document !== 'undefined' ? createPortal(modal, document.body) : modal}
    </>
  )
}
