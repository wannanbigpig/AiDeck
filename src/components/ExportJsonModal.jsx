import { useEffect, useMemo, useState } from 'react'
import Modal from './Modal'

const SENSITIVE_KEYWORDS = [
  'token',
  'secret',
  'password',
  'authorization',
  'api_key',
  'apikey',
  'cookie'
]

const ID_LIKE_KEYS = [
  'id',
  'user_id',
  'account_id',
  'organization_id',
  'auth_id',
  'workspace_id'
]

function maskEmail (email) {
  const raw = String(email || '').trim()
  const at = raw.indexOf('@')
  if (at <= 1) return '***'
  const local = raw.slice(0, at)
  const domain = raw.slice(at + 1)
  const head = local.slice(0, 2)
  const tail = local.length > 4 ? local.slice(-1) : ''
  const maskedLocal = `${head}${'*'.repeat(Math.max(2, local.length - head.length - tail.length))}${tail}`
  return `${maskedLocal}@${domain}`
}

function maskMiddle (value, head = 4, tail = 4) {
  const raw = String(value || '')
  if (!raw) return ''
  if (raw.length <= head + tail + 3) return '*'.repeat(Math.min(Math.max(raw.length, 3), 8))
  return `${raw.slice(0, head)}...${raw.slice(-tail)}`
}

function shouldMaskByKey (key) {
  const lower = String(key || '').toLowerCase()
  return SENSITIVE_KEYWORDS.some((item) => lower.includes(item))
}

function isIdLikeKey (key) {
  const lower = String(key || '').toLowerCase()
  return ID_LIKE_KEYS.includes(lower) || lower.endsWith('_id')
}

function maskObject (value, key = '') {
  if (value == null) return value

  if (Array.isArray(value)) {
    return value.map((item) => maskObject(item, key))
  }

  if (typeof value === 'object') {
    const next = {}
    for (const k of Object.keys(value)) {
      next[k] = maskObject(value[k], k)
    }
    return next
  }

  if (typeof value !== 'string') return value

  const raw = String(value)
  const lowerKey = String(key || '').toLowerCase()
  if (!raw) return raw

  if (lowerKey === 'email' || raw.includes('@')) {
    return maskEmail(raw)
  }

  if (shouldMaskByKey(lowerKey)) {
    return maskMiddle(raw, 6, 4)
  }

  if (isIdLikeKey(lowerKey)) {
    return maskMiddle(raw, 4, 4)
  }

  return raw
}

function buildMaskedJsonText (jsonText) {
  const raw = String(jsonText || '')
  if (!raw.trim()) return ''
  try {
    const parsed = JSON.parse(raw)
    const masked = maskObject(parsed)
    return JSON.stringify(masked, null, 2)
  } catch (e) {
    return raw
  }
}

/**
 * 导出 JSON 预览弹窗
 */
export default function ExportJsonModal ({
  open,
  onClose,
  jsonText = '',
  title = '导出 JSON',
  onCopy,
  onDownload
}) {
  const [showFullPreview, setShowFullPreview] = useState(false)
  const hasContent = String(jsonText || '').length > 0
  const maskedJsonText = useMemo(() => buildMaskedJsonText(jsonText), [jsonText])
  const displayText = showFullPreview ? String(jsonText || '') : maskedJsonText

  useEffect(() => {
    if (open) {
      setShowFullPreview(false)
    }
  }, [open, jsonText])

  return (
    <Modal
      title={title}
      open={open}
      onClose={onClose}
      contentClassName='export-json-modal-content'
    >
      <div className='export-json-toolbar'>
        <button
          className={`btn btn-sm export-json-toolbar-btn ${showFullPreview ? 'active' : ''}`}
          type='button'
          onClick={() => setShowFullPreview(prev => !prev)}
          disabled={!hasContent}
        >
          {showFullPreview ? '🙈 隐藏' : '👁 预览'}
        </button>
        <button className='btn btn-sm export-json-toolbar-btn' type='button' onClick={onCopy} disabled={!hasContent}>
          📋 复制
        </button>
        <button className='btn btn-sm btn-primary export-json-toolbar-btn' type='button' onClick={onDownload} disabled={!hasContent}>
          ⬇ 下载
        </button>
      </div>

      <textarea
        className='export-json-preview'
        value={displayText}
        readOnly
        spellCheck={false}
      />
      <div className='oauth-hint' style={{ marginTop: 8 }}>
        默认显示脱敏预览，点击“预览”可切换查看完整导出内容。
      </div>
    </Modal>
  )
}
