export function buildSharedAccountBackFields (options = {}) {
  const {
    addMethod = '',
    loginMethod = '',
    tier = '',
    addedAt = '',
    statusText = '',
    statusColor = ''
  } = options

  const fields = []

  if (addMethod) {
    fields.push({ key: 'add-method', label: '添加方式', text: addMethod })
  }
  if (loginMethod) {
    fields.push({ key: 'login-method', label: '登录方式', text: loginMethod })
  }
  if (tier) {
    fields.push({ key: 'tier', label: '套餐层级', text: tier })
  }
  if (addedAt) {
    fields.push({ key: 'added-at', label: '添加时间', text: addedAt })
  }
  if (statusText) {
    fields.push({ key: 'status', label: '状态', text: statusText, color: statusColor })
  }

  return fields
}
