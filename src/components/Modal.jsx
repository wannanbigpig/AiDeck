import { useState } from 'react'

/**
 * 通用模态框组件
 */
export default function Modal ({ title, open, onClose, children, footer }) {
  if (!open) return null

  return (
    <div className='modal-overlay' onClick={onClose}>
      <div className='modal-content' onClick={(e) => e.stopPropagation()}>
        <div className='modal-header'>
          <h3 className='modal-title'>{title}</h3>
          <button className='modal-close' onClick={onClose}>✕</button>
        </div>
        <div className='modal-body'>
          {children}
        </div>
        {footer
          ? <div className='modal-footer'>{footer}</div>
          : null}
      </div>
    </div>
  )
}

/**
 * 确认对话框
 */
export function ConfirmModal ({ title, message, open, onConfirm, onCancel, danger }) {
  if (!open) return null

  return (
    <Modal
      title={title || '确认'}
      open={open}
      onClose={onCancel}
      footer={
        <>
          <button className='btn' onClick={onCancel}>取消</button>
          <button
            className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`}
            onClick={onConfirm}
          >
            确定
          </button>
        </>
      }
    >
      <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>{message}</p>
    </Modal>
  )
}
