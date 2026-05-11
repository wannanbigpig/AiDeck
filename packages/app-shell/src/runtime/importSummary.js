const ACTION_LABELS = {
  added: '新增',
  merged: '合并',
  skipped: '跳过',
  invalid: '无效'
}

const REASON_LABELS = {
  same_id: '同一账号',
  same_refresh_token: '同 refresh_token',
  same_access_token: '同 access_token',
  same_email_project: '同邮箱和项目',
  single_same_email: '同邮箱唯一匹配',
  same_auth_id: '同 auth_id',
  ambiguous_same_email: '同邮箱多账号',
  older_than_existing: '已有更新记录',
  invalid_record: '记录无效',
  new_identity: '新身份',
  same_id_or_email: '同账号或邮箱'
}

function normalizeItems (details) {
  if (Array.isArray(details)) return details
  if (details && Array.isArray(details.items)) return details.items
  return []
}

export function summarizeImportDetails (details, fallbackCount = 0) {
  const items = normalizeItems(details)
  const counts = {
    added: 0,
    merged: 0,
    skipped: 0,
    invalid: 0
  }
  const reasons = []

  for (let i = 0; i < items.length; i++) {
    const item = items[i] && typeof items[i] === 'object' ? items[i] : {}
    const action = String(item.action || '').trim()
    if (Object.prototype.hasOwnProperty.call(counts, action)) counts[action]++
    const reason = String(item.reason || '').trim()
    if (reason && !reasons.includes(reason)) reasons.push(reason)
  }

  const total = items.length > 0 ? items.length : Number(fallbackCount || 0)
  return {
    total,
    counts,
    reasons,
    hasDetails: items.length > 0
  }
}

export function formatImportSummary (details, fallbackCount = 0, noun = '账号') {
  const summary = summarizeImportDetails(details, fallbackCount)
  if (!summary.hasDetails) {
    return `成功导入 ${summary.total} 个${noun}`
  }

  const parts = []
  for (const action of ['added', 'merged', 'skipped', 'invalid']) {
    const count = summary.counts[action]
    if (count > 0) parts.push(`${ACTION_LABELS[action]} ${count}`)
  }
  const reasonText = summary.reasons
    .slice(0, 2)
    .map(reason => REASON_LABELS[reason] || reason)
    .join('、')

  return [
    `导入完成：${parts.join('，') || `处理 ${summary.total}`}`,
    reasonText ? `（${reasonText}${summary.reasons.length > 2 ? '等' : ''}）` : ''
  ].join('')
}
