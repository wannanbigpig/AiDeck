import React, { useState, useEffect } from 'react'
import Modal from '../../components/Modal'
import {
  ChevronDownIcon,
  ChevronUpIcon
} from '../../components/Icons/ActionIcons'
import RefreshIntervalSlider from '../../components/RefreshIntervalSlider'
import AutoSwitchThresholdSlider from '../../components/AutoSwitchThresholdSlider'
import GoogleOAuthCredentialHelp from '../../components/GoogleOAuthCredentialHelp'
import { normalizeAntigravityAdvancedSettings } from '../../utils/antigravity'
import { showOpenDialog, writeSharedSetting } from '../../utils/hostBridge.js'

export default function AntigravitySettingsModal({ open, onClose, toast, settings: outerSettings, onSettingsChange, svc }) {
  const [settings, setSettings] = useState(() => normalizeAntigravityAdvancedSettings(outerSettings))
  const [resolvedStartupPath, setResolvedStartupPath] = useState('')
  const [deviceIdentityOpen, setDeviceIdentityOpen] = useState(false)
  const [deviceIdentityLoading, setDeviceIdentityLoading] = useState(false)
  const [deviceIdentityDetail, setDeviceIdentityDetail] = useState(null)

  useEffect(() => {
    if (!open) return
    setSettings(normalizeAntigravityAdvancedSettings(outerSettings))
  }, [open, outerSettings])

  useEffect(() => {
    if (!open) return
    const explicit = String(settings.startupPath || '').trim()
    if (explicit) {
      setResolvedStartupPath(explicit)
      return
    }
    setResolvedStartupPath('')
    const fallback = typeof svc?.getDefaultAntigravityAppPath === 'function'
      ? String(svc.getDefaultAntigravityAppPath() || '').trim()
      : ''
    setResolvedStartupPath(fallback)
  }, [open, settings.startupPath, svc])

  useEffect(() => {
    if (open) return
    setDeviceIdentityOpen(false)
    setDeviceIdentityLoading(false)
    setDeviceIdentityDetail(null)
  }, [open])

  const handleChange = (key, val) => {
    const next = normalizeAntigravityAdvancedSettings({ ...settings, [key]: val })
    setSettings(next)
    writeSharedSetting('antigravity_advanced_settings', next)
    onSettingsChange?.(next)
  }

  const handlePickStartupPath = async () => {
    const files = await showOpenDialog({
      title: '选择 Antigravity 启动路径',
      properties: ['openFile', 'openDirectory']
    })
    if (!files || !files[0]) return
    handleChange('startupPath', files[0])
    toast.success('已更新启动路径')
  }

  const handleAutoDetectStartupPath = () => {
    if (!svc || typeof svc.detectAntigravityAppPath !== 'function') {
      toast.warning('当前版本不支持自动探测')
      return
    }
    const detected = svc.detectAntigravityAppPath(settings.startupPath || '')
    if (!detected) {
      toast.warning('未探测到 Antigravity 可执行路径，请手动选择')
      return
    }
    handleChange('startupPath', detected)
    toast.success('已自动探测启动路径')
  }

  const handleRestoreOriginalDeviceIdentity = () => {
    if (!svc || typeof svc.restoreOriginalDeviceIdentity !== 'function') {
      toast.warning('当前版本不支持恢复原始设备身份')
      return
    }
    const result = svc.restoreOriginalDeviceIdentity()
    if (!result || !result.success) {
      toast.warning((result && result.error) || '恢复原始设备身份失败')
      return
    }
    toast.success('已恢复原始设备身份')
    if (result.warning) {
      toast.info(result.warning)
    }
  }

  const loadCurrentDeviceIdentity = async ({ silent = false } = {}) => {
    if (!svc || typeof svc.getCurrentDeviceIdentity !== 'function') {
      if (!silent) toast.warning('当前版本不支持读取设备身份详情')
      return false
    }
    setDeviceIdentityLoading(true)
    try {
      const result = await Promise.resolve(svc.getCurrentDeviceIdentity())
      if (!result || !result.success) {
        if (!silent) {
          toast.warning((result && result.error) || '读取当前设备身份失败')
        }
        return false
      }
      setDeviceIdentityDetail(result)
      return true
    } finally {
      setDeviceIdentityLoading(false)
    }
  }

  const handleOpenDeviceIdentityDetail = async () => {
    const ok = await loadCurrentDeviceIdentity()
    if (!ok) return
    setDeviceIdentityOpen(true)
  }

  const ToggleSwitch = ({ checked, onChange }) => (
    <label className="ag-switch">
      <input type='checkbox' checked={checked} onChange={onChange} />
      <span className="ag-switch-slider" />
    </label>
  )

  const PathRow = ({ label, pathValue, onPick, onDetect }) => (
    <div style={{ marginTop: 12, padding: '12px', background: 'var(--bg-surface)', borderRadius: 8, border: '1px solid var(--border-muted)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 500 }}>{label}</div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button className='btn btn-sm' onClick={onDetect} style={{ background: 'transparent' }}>探测</button>
          <button className='btn btn-sm' onClick={onPick} style={{ background: 'var(--bg-elevated)' }}>选择</button>
        </div>
      </div>
      <input
        type='text'
        readOnly
        value={pathValue || ''}
        placeholder='未设置路径'
        className='settings-input'
        style={{ width: '100%', fontSize: 12, fontFamily: 'var(--font-mono)' }}
      />
    </div>
  )

  return (
    <Modal title='Antigravity 设置' open={open} onClose={onClose} contentClassName='settings-platform-modal'>
      <div className="settings-modal-content">
        <div className="settings-section">
          <div className="settings-section-title">Google OAuth 凭证</div>
          <div className="settings-desc" style={{ marginBottom: 12 }}>
            仅保存在本机设置中，用于 Antigravity 的 OAuth 授权和 refresh_token 刷新，不会写入代码仓库。
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div>
              <div className="settings-label" style={{ marginBottom: 6 }}>Client ID</div>
              <input
                className='settings-input'
                type='text'
                value={settings.oauthClientId || ''}
                placeholder='输入 Google OAuth Client ID'
                onChange={e => handleChange('oauthClientId', e.target.value)}
              />
            </div>

            <div>
              <div className="settings-label" style={{ marginBottom: 6 }}>Client Secret</div>
              <input
                className='settings-input'
                type='password'
                value={settings.oauthClientSecret || ''}
                placeholder='输入 Google OAuth Client Secret'
                onChange={e => handleChange('oauthClientSecret', e.target.value)}
              />
            </div>
          </div>

          <GoogleOAuthCredentialHelp
            platformName='Antigravity'
            redirectUris={[
              'http://localhost:1456/auth/callback',
              'http://127.0.0.1:1456/auth/callback'
            ]}
          />
        </div>

        <div className="settings-section">


          <div className="settings-row">
            <div className="settings-info">
              <div className="settings-label">配额自动刷新</div>
              <div className="settings-desc">定期自动检查并更新所有账号的可用配额。</div>
            </div>
            <ToggleSwitch
              checked={settings.autoRefreshMinutes > 0}
              onChange={e => handleChange('autoRefreshMinutes', e.target.checked ? 10 : 0)}
            />
          </div>

          {settings.autoRefreshMinutes > 0 && (
            <div style={{ marginTop: 8 }}>
              <RefreshIntervalSlider
                value={settings.autoRefreshMinutes}
                onChange={(nextValue) => handleChange('autoRefreshMinutes', nextValue)}
              />
            </div>
          )}

          <div className="settings-row">
            <div className="settings-info">
              <div className="settings-label">配额聚合显示</div>
              <div className="settings-desc">开启后按 Claude / Gemini 3.1 Pro / Gemini 3 Flash 聚合显示；关闭后按 Antigravity IDE 同款模型项显示。</div>
            </div>
            <ToggleSwitch
              checked={settings.quotaAggregatedDisplay}
              onChange={e => handleChange('quotaAggregatedDisplay', e.target.checked)}
            />
          </div>
        </div>

        {/* 设备身份 */}
        <div className="settings-section">
          <div className="settings-row" style={{ alignItems: 'flex-start' }}>
            <div className="settings-info">
              <div className="settings-section-title" style={{ marginBottom: 8 }}>设备身份</div>
              <div className="settings-desc">
                管理当前本机的设备指纹备份与恢复。恢复操作不会影响账号数据。
              </div>
            </div>
            <button className='btn btn-sm' onClick={handleOpenDeviceIdentityDetail}>详情</button>
          </div>
        </div>

        {/* IDE 启动与切号联动 */}
        <div className="settings-section">
          <div className="settings-row">
            <div className="settings-info">
              <div className="settings-label">切换时重启 Antigravity App</div>
              <div className="settings-desc">更新登录态后尝试重启客户端，让新账号立即生效。</div>
            </div>
            <ToggleSwitch
              checked={settings.autoRestartAntigravityApp}
              onChange={e => handleChange('autoRestartAntigravityApp', e.target.checked)}
            />
          </div>

          {settings.autoRestartAntigravityApp && (
            <>
              <div className="settings-row" style={{ paddingLeft: 12 }}>
                <div className="settings-info">
                  <div className="settings-label" style={{ fontSize: 13, fontWeight: 400 }}>若已关闭则自动启动</div>
                </div>
                <ToggleSwitch
                  checked={settings.autoStartAntigravityAppWhenClosed}
                  onChange={e => handleChange('autoStartAntigravityAppWhenClosed', e.target.checked)}
                />
              </div>
              <div style={{ paddingLeft: 12 }}>
                <PathRow
                  label='Antigravity 启动路径'
                  pathValue={resolvedStartupPath}
                  onPick={handlePickStartupPath}
                  onDetect={handleAutoDetectStartupPath}
                />
              </div>
            </>
          )}
        </div>

        {/* 自动切号 */}
        <div className="settings-section" style={{ borderBottom: 'none' }}>
          <div className="settings-row">
            <div className="settings-info">
              <div className="settings-label">切号时更换设备身份</div>
              <div className="settings-desc">同步切换账号绑定的设备指纹，模拟真实环境。</div>
            </div>
            <ToggleSwitch
              checked={settings.switchDeviceIdentity}
              onChange={e => handleChange('switchDeviceIdentity', e.target.checked)}
            />
          </div>

          <div className="settings-row">
            <div className="settings-info">
              <div className="settings-label">自动切换低配额账号</div>
              <div className="settings-desc">当账号配额低于设定阈值时，自动切换到更高配额账号。</div>
            </div>
            <ToggleSwitch
              checked={settings.autoSwitch}
              onChange={e => handleChange('autoSwitch', e.target.checked)}
            />
          </div>

          {settings.autoSwitch && (
            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 14, paddingLeft: 4 }}>
              <AutoSwitchThresholdSlider
                title='切号阈值'
                description='当命中监控模型且剩余配额低于该阈值时，尝试自动切换。'
                value={settings.autoSwitchThreshold}
                onChange={(nextValue) => handleChange('autoSwitchThreshold', nextValue)}
                min={0}
                max={30}
                step={1}
                accent='blue'
                marks={[
                  { value: 0, label: '0%' },
                  { value: 15, label: '15%' },
                  { value: 30, label: '30%' }
                ]}
              />

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>监控模型范围</span>
                <select
                  className='settings-input'
                  style={{ width: 140, background: 'var(--bg-surface)' }}
                  value={settings.autoSwitchModelGroup}
                  onChange={e => handleChange('autoSwitchModelGroup', e.target.value)}
                >
                  <option value='any'>所有模型</option>
                  <option value='claude'>Claude</option>
                  <option value='gemini_pro'>Gemini 3.1 Pro</option>
                  <option value='gemini_flash'>Gemini 3 Flash</option>
                </select>
              </div>
            </div>
          )}
        </div>

        <div className="settings-section" style={{ borderBottom: 'none' }}>
          <div className="settings-section-title">系统级配额预警通知</div>
          <div className="settings-row">
            <div className="settings-info">
              <div className="settings-label">启用系统级预警</div>
              <div className="settings-desc">仅监控当前激活账号。命中阈值后发送宿主系统通知，点击可跳到 Antigravity 页面。</div>
            </div>
            <ToggleSwitch
              checked={settings.quotaWarningEnabled}
              onChange={e => handleChange('quotaWarningEnabled', e.target.checked)}
            />
          </div>

          {settings.quotaWarningEnabled && (
            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 14, paddingLeft: 4 }}>
              <AutoSwitchThresholdSlider
                title='Claude 预警阈值'
                description='当前激活账号的 Claude 聚合分组剩余配额低于或等于该阈值时发送系统通知。'
                value={settings.quotaWarningClaudeThreshold}
                onChange={(nextValue) => handleChange('quotaWarningClaudeThreshold', nextValue)}
                min={0}
                max={30}
                step={1}
                accent='blue'
                marks={[
                  { value: 0, label: '0%' },
                  { value: 15, label: '15%' },
                  { value: 30, label: '30%' }
                ]}
              />

              <AutoSwitchThresholdSlider
                title='Gemini 3.1 Pro 预警阈值'
                description='当前激活账号的 Gemini 3.1 Pro 聚合分组剩余配额低于或等于该阈值时发送系统通知。'
                value={settings.quotaWarningGeminiProThreshold}
                onChange={(nextValue) => handleChange('quotaWarningGeminiProThreshold', nextValue)}
                min={0}
                max={30}
                step={1}
                accent='purple'
                marks={[
                  { value: 0, label: '0%' },
                  { value: 15, label: '15%' },
                  { value: 30, label: '30%' }
                ]}
              />

              <AutoSwitchThresholdSlider
                title='Gemini 3 Flash 预警阈值'
                description='当前激活账号的 Gemini 3 Flash 聚合分组剩余配额低于或等于该阈值时发送系统通知。'
                value={settings.quotaWarningGeminiFlashThreshold}
                onChange={(nextValue) => handleChange('quotaWarningGeminiFlashThreshold', nextValue)}
                min={0}
                max={30}
                step={1}
                accent='blue'
                marks={[
                  { value: 0, label: '0%' },
                  { value: 15, label: '15%' },
                  { value: 30, label: '30%' }
                ]}
              />
            </div>
          )}
        </div>
      </div>

      <Modal
        title='当前设备身份'
        open={deviceIdentityOpen}
        onClose={() => setDeviceIdentityOpen(false)}
      >
        {deviceIdentityDetail
          ? (
            <div className="settings-modal-content">
              <div className="settings-desc" style={{ marginBottom: 12 }}>
                直接读取官方客户端本地运行态。`service_machine_id` 会按 machineid / state.vscdb 的同步结果展示。
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
                <button className='btn btn-sm' onClick={handleRestoreOriginalDeviceIdentity}>恢复原始身份</button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {[
                  ['machine_id', deviceIdentityDetail.profile?.machine_id],
                  ['mac_machine_id', deviceIdentityDetail.profile?.mac_machine_id],
                  ['dev_device_id', deviceIdentityDetail.profile?.dev_device_id],
                  ['sqm_id', deviceIdentityDetail.profile?.sqm_id],
                  ['service_machine_id', deviceIdentityDetail.profile?.service_machine_id]
                ].map(([label, value]) => (
                  <div
                    key={label}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '160px minmax(0, 1fr)',
                      gap: 16,
                      alignItems: 'start',
                      padding: '6px 0'
                    }}
                  >
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600, lineHeight: 1.8 }}>{label}</div>
                    <div
                      style={{
                        fontSize: 12,
                        color: 'var(--text-primary)',
                        fontFamily: 'var(--font-mono)',
                        lineHeight: 1.6,
                        wordBreak: 'break-all'
                      }}
                    >
                      {String(value || '-')}
                    </div>
                  </div>
                ))}
              </div>

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 12,
                  fontSize: 12,
                  color: 'var(--text-secondary)',
                  marginTop: 8,
                  paddingTop: 8
                }}
              >
                <span>原始备份: {deviceIdentityDetail.hasOriginalBackup ? '已存在' : '未备份'}</span>
                <span>缺失字段: {Array.isArray(deviceIdentityDetail.missingFields) && deviceIdentityDetail.missingFields.length > 0 ? deviceIdentityDetail.missingFields.join(', ') : '无'}</span>
              </div>
            </div>
          )
          : (
            <div style={{ color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', padding: '20px 0' }}>
              {deviceIdentityLoading ? '正在读取当前设备身份...' : '暂无设备身份详情'}
            </div>
          )}
      </Modal>
    </Modal>
  )
}
