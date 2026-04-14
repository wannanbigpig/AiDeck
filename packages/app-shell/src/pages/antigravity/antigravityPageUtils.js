import { maskText } from '../../utils/format'
import { ANTIGRAVITY_SETTINGS_KEY, readAntigravityAdvancedSettings as readAntigravitySettingsFromStore } from '../../utils/antigravity'

export { ANTIGRAVITY_SETTINGS_KEY }

function truncateMiddleText (value, head = 14, tail = 8) {
  const text = String(value || '').trim()
  if (!text) return ''
  if (text.length <= head + tail + 1) return text
  return text.slice(0, head) + '...' + text.slice(-tail)
}

export function getQuotaRefreshIssueMessage (result) {
  if (!result || typeof result !== 'object') return ''
  const direct = String(result.error || result.warning || result?.quota_error?.message || '').trim()
  if (direct) return direct
  const msg = String(result.message || '').trim()
  if (msg.includes('未获取到') || msg.includes('暂无配额')) return msg
  return ''
}

export function getAntigravityDeviceIdentityMeta (account) {
  const profile = account && account.device_profile && typeof account.device_profile === 'object'
    ? account.device_profile
    : null
  const sourceKey = String(account?.device_profile_source || '').trim().toLowerCase()
  const sourceMap = {
    captured: '本地捕获',
    generated: '自动生成',
    imported: '导入继承'
  }

  return {
    profile,
    sourceKey,
    sourceLabel: sourceMap[sourceKey] || (profile ? '已绑定' : '未绑定')
  }
}

export function getAntigravityDeviceIdentityDisplay (account, isPrivacyMode) {
  const { profile, sourceLabel } = getAntigravityDeviceIdentityMeta(account)
  if (!profile) {
    return { text: '未绑定', displayText: '未绑定' }
  }

  const machineIdRaw = String(profile.machine_id || '').trim()
  const serviceMachineIdRaw = String(profile.service_machine_id || '').trim()
  const machineId = isPrivacyMode ? maskText(machineIdRaw || '-', 'id') : truncateMiddleText(machineIdRaw || '-', 16, 8)
  const serviceMachineId = isPrivacyMode ? maskText(serviceMachineIdRaw || '-', 'id') : truncateMiddleText(serviceMachineIdRaw || '-', 8, 6)

  return {
    text: sourceLabel + ' | ' + (machineIdRaw || '-') + (serviceMachineIdRaw ? (' · ' + serviceMachineIdRaw) : ''),
    displayText: sourceLabel + ' | ' + machineId + (serviceMachineIdRaw ? (' · ' + serviceMachineId) : '')
  }
}

export function readAntigravityAdvancedSettings () {
  return readAntigravitySettingsFromStore()
}
