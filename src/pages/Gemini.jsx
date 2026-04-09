import { useEffect, useState } from 'react'
import QuotaBar from '../components/QuotaBar'
import Modal, { ConfirmModal } from '../components/Modal'
import { useToast } from '../components/Toast'
import { formatDate, truncateEmail } from '../utils/format'
import { PlatformIcon } from '../components/PlatformIcons'

/**
 * Gemini CLI 账号管理页
 */
export default function Gemini ({ onRefresh, onActivity, searchQuery = '' }) {
  const [accounts, setAccounts] = useState([])
  const [currentId, setCurrentId] = useState(null)
  const [showImport, setShowImport] = useState(false)
  const [importJson, setImportJson] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [loading, setLoading] = useState(false)
  const toast = useToast()

  const svc = window.services?.gemini

  useEffect(() => { refresh() }, [])

  function refresh () {
    if (!svc) return
    setAccounts(svc.list())
    const cur = svc.getCurrent()
    setCurrentId(cur?.id || null)
    onRefresh?.()
  }

  function handleImportLocal () {
    setLoading(true)
    try {
      const result = svc.importFromLocal()
      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success(`成功导入 ${result.imported.length} 个 Gemini 账号`)
        refresh()
      }
    } catch (e) {
      toast.error('导入失败: ' + e.message)
    }
    setLoading(false)
  }

  function handleImportJson () {
    if (!importJson.trim()) {
      toast.warning('请输入 JSON 内容')
      return
    }
    const result = svc.importFromJson(importJson)
    if (result.error) {
      toast.error(result.error)
    } else {
      toast.success(`成功导入 ${result.imported.length} 个账号`)
      setShowImport(false)
      setImportJson('')
      refresh()
    }
  }

  function handleInject (id) {
    const result = svc.inject(id)
    if (result.success) {
      toast.success('注入成功 — ~/.gemini/ 凭证已更新')
      refresh()
    } else {
      toast.error(result.error || '注入失败')
    }
  }

  function handleDelete (id) {
    svc.deleteAccount(id)
    toast.success('已删除')
    setConfirmDelete(null)
    refresh()
  }

  function handleRefreshToken (id) {
    const result = svc.refreshToken(id)
    if (result.message) {
      toast.info(result.message)
    }
    refresh()
  }

  function handleExport () {
    const ids = accounts.map(a => a.id)
    const json = svc.exportAccounts(ids)
    if (window.utools) {
      window.utools.copyText(json)
      toast.success('已复制到剪贴板')
    }
  }

  return (
    <div>
      <div className='page-header'>
        <div>
          <h1 className='page-title'><PlatformIcon platform="gemini" size={24} /> Gemini CLI</h1>
          <p className='page-subtitle'>
            {accounts.length} 个账号
            {currentId ? ' · 已激活' : ''} · 凭证路径: ~/.gemini/
          </p>
        </div>
        <div className='page-actions'>
          <button className='btn' onClick={handleImportLocal} disabled={loading}>
            📂 本地导入
          </button>
          <button className='btn' onClick={() => setShowImport(true)}>
            📋 JSON 导入
          </button>
          {accounts.length > 0 && (
            <button className='btn' onClick={handleExport}>
              📤 导出
            </button>
          )}
        </div>
      </div>

      {accounts.length === 0
        ? (
          <div className='empty-state'>
            <div className='empty-state-icon'>✨</div>
            <div className='empty-state-text'>
              暂无 Gemini CLI 账号<br />
              点击"本地导入"从 ~/.gemini/ 目录读取当前登录账号
            </div>
          </div>
          )
        : (
          <div className='account-grid'>
            {accounts.filter(acc => {
              if (!searchQuery) return true
              return `${acc.email || ''} ${acc.username || ''} ${acc.id || ''}`
                .toLowerCase()
                .includes(searchQuery.trim().toLowerCase())
            }).map(account => (
              <GeminiAccountItem
                key={account.id}
                account={account}
                isCurrent={account.id === currentId}
                onInject={() => handleInject(account.id)}
                onRefresh={() => handleRefreshToken(account.id)}
                onDelete={() => setConfirmDelete(account.id)}
                svc={svc}
              />
            ))}
          </div>
          )}


      <Modal
        title='JSON 导入 Gemini 账号'
        open={showImport}
        onClose={() => setShowImport(false)}
        footer={
          <>
            <button className='btn' onClick={() => setShowImport(false)}>取消</button>
            <button className='btn btn-primary' onClick={handleImportJson}>导入</button>
          </>
        }
      >
        <div className='form-group'>
          <label className='form-label'>粘贴账号 JSON 数据</label>
          <textarea
            className='form-textarea'
            placeholder='[{"email":"...","access_token":"...","refresh_token":"..."}]'
            value={importJson}
            onChange={(e) => setImportJson(e.target.value)}
          />
        </div>
      </Modal>

      <ConfirmModal
        title='删除账号'
        message='确定要删除此 Gemini 账号吗？此操作不可恢复。'
        open={confirmDelete !== null}
        danger
        onConfirm={() => handleDelete(confirmDelete)}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  )
}

function GeminiAccountItem ({ account, isCurrent, onInject, onRefresh, onDelete, svc }) {
  const planBadge = svc?.getPlanBadge(account) || ''

  const planBadgeClass = (() => {
    switch (planBadge) {
      case 'PRO': return 'badge-pro'
      case 'ULTRA': return 'badge-ultra'
      case 'FREE': return 'badge-free'
      default: return 'badge-free'
    }
  })()

  return (
    <div className={`account-card ${isCurrent ? 'current' : ''}`}>
      <div className='account-card-row'>
        <span className='account-email'>{truncateEmail(account.email, 28)}</span>
        {planBadge && <span className={`badge ${planBadgeClass}`}>{planBadge}</span>}
        {isCurrent && <span className='badge badge-active'>当前</span>}
      </div>

      {account.tags && account.tags.length > 0 && (
        <div className='account-tags'>
          {account.tags.map((tag, i) => <span key={i} className='tag'>{tag}</span>)}
        </div>
      )}

      {/* Gemini 暂无配额 API，预留位置 */}
      {account.quota && typeof account.quota.hourly_percentage === 'number' && (
        <div style={{ marginTop: 12 }}>
          <QuotaBar percentage={account.quota.hourly_percentage} label='配额' />
        </div>
      )}

      <div className='account-meta'>
        {account.tier_id && <span>Tier: {account.tier_id}</span>}
        {account.created_at
          ? <span>· 创建: {formatDate(account.created_at)}</span>
          : null}
        {account.last_used
          ? <span>· 最后注入: {formatDate(account.last_used)}</span>
          : null}
      </div>

      <div className='account-actions'>
        <button className='btn btn-primary btn-sm' onClick={onInject}>
          💉 {isCurrent ? '重新注入' : '注入'}
        </button>
        <button className='btn btn-sm' onClick={onRefresh}>
          🔑 刷新Token
        </button>
        <button className='btn btn-danger btn-sm' onClick={onDelete} style={{ marginLeft: 'auto' }}>
          🗑
        </button>
      </div>
    </div>
  )
}
