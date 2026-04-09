import { useEffect, useState } from 'react'
import QuotaBar from '../components/QuotaBar'
import Modal, { ConfirmModal } from '../components/Modal'
import { useToast } from '../components/Toast'
import { formatDate, truncateEmail, formatResetTime } from '../utils/format'
import { PlatformIcon } from '../components/PlatformIcons'

/**
 * Antigravity 账号管理页
 */
export default function Antigravity ({ onRefresh, onActivity, searchQuery = '' }) {
  const [accounts, setAccounts] = useState([])
  const [currentId, setCurrentId] = useState(null)
  const [showImport, setShowImport] = useState(false)
  const [importJson, setImportJson] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [loading, setLoading] = useState(false)
  const toast = useToast()

  const svc = window.services?.antigravity

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
        toast.success(`成功导入 ${result.imported.length} 个账号`)
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

  function handleSwitch (id) {
    const result = svc.switchAccount(id)
    if (result.success) {
      toast.success('切换成功')
      refresh()
    } else {
      toast.error(result.error || '切换失败')
    }
  }

  function handleDelete (id) {
    svc.deleteAccount(id)
    toast.success('已删除')
    setConfirmDelete(null)
    refresh()
  }

  function handleRefreshQuota (id) {
    const result = svc.refreshQuota(id)
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
          <h1 className='page-title'><PlatformIcon platform="antigravity" size={24} /> Antigravity</h1>
          <p className='page-subtitle'>
            {accounts.length} 个账号
            {currentId ? ' · 已激活' : ''}
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
            <div className='empty-state-icon'>🚀</div>
            <div className='empty-state-text'>
              暂无 Antigravity 账号<br />
              点击"本地导入"或"JSON 导入"添加账号
            </div>
          </div>
          )
        : (
          <div className='account-grid'>
            {accounts.filter(acc => {
              if (!searchQuery) return true
              return `${acc.email || ''} ${acc.username || ''} ${acc.name || ''} ${acc.id || ''}`
                .toLowerCase()
                .includes(searchQuery.trim().toLowerCase())
            }).map(account => (
              <AccountItem
                key={account.id}
                account={account}
                isCurrent={account.id === currentId}
                onSwitch={() => handleSwitch(account.id)}
                onRefresh={() => handleRefreshQuota(account.id)}
                onDelete={() => setConfirmDelete(account.id)}
              />
            ))}
          </div>
        )}


      {/* JSON 导入弹窗 */}
      <Modal
        title='JSON 导入 Antigravity 账号'
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
            placeholder='[{"email":"...","token":{"access_token":"...","refresh_token":"..."}}]'
            value={importJson}
            onChange={(e) => setImportJson(e.target.value)}
          />
        </div>
      </Modal>

      {/* 删除确认 */}
      <ConfirmModal
        title='删除账号'
        message='确定要删除此账号吗？此操作不可恢复。'
        open={confirmDelete !== null}
        danger
        onConfirm={() => handleDelete(confirmDelete)}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  )
}

function AccountItem ({ account, isCurrent, onSwitch, onRefresh, onDelete }) {
  const quota = account.quota
  const models = quota?.models || []

  return (
    <div className={`account-card ${isCurrent ? 'current' : ''}`}>
      <div className='account-card-row'>
        <span className='account-email'>{truncateEmail(account.email, 28)}</span>
        {isCurrent && <span className='badge badge-active'>当前</span>}
      </div>

      {account.tags && account.tags.length > 0 && (
        <div className='account-tags'>
          {account.tags.map((tag, i) => <span key={i} className='tag'>{tag}</span>)}
        </div>
      )}

      {models && models.length > 0 && (
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {models.map((m, idx) => (
            <QuotaBar
              key={idx}
              percentage={m.percentage}
              label={m.display_name || m.name}
              requestsLeft={m.requests_left}
              requestsLimit={m.requests_limit}
              resetTime={m.reset_time ? formatResetTime(m.reset_time) : ''}
            />
          ))}
        </div>
      )}

      <div className='account-meta'>
        {account.created_at
          ? <span>创建: {formatDate(account.created_at)}</span>
          : null}
        {account.last_used
          ? <span>· 最后使用: {formatDate(account.last_used)}</span>
          : null}
      </div>

      <div className='account-actions'>
        {!isCurrent && (
          <button className='btn btn-primary btn-sm' onClick={onSwitch}>
            ⚡ 切换
          </button>
        )}
        <button className='btn btn-sm' onClick={onRefresh}>
          🔄 刷新
        </button>
        <button className='btn btn-danger btn-sm' onClick={onDelete} style={{ marginLeft: 'auto' }}>
          🗑
        </button>
      </div>
    </div>
  )
}
