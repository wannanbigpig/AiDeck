import React, { useState, useEffect } from 'react'
import Modal from '../../components/Modal'
import { 
  ArrowPathIcon,
  ChevronDownIcon,
  ChevronUpIcon 
} from '../../components/Icons/ActionIcons'
import RefreshIntervalSlider from '../../components/RefreshIntervalSlider'
import AutoSwitchThresholdSlider from '../../components/AutoSwitchThresholdSlider'
import { normalizeCodexAdvancedSettings } from '../../utils/codex'
import { showOpenDialog, writeSharedSetting } from '../../utils/hostBridge.js'

export default function CodexSettingsModal ({ open, onClose, toast, settings: outerSettings, onSettingsChange, svc }) {
  const [settings, setSettings] = useState(() => normalizeCodexAdvancedSettings(outerSettings))
  const [resolvedCodexStartupPath, setResolvedCodexStartupPath] = useState('')
  const [resolvedOpenCodeStartupPath, setResolvedOpenCodeStartupPath] = useState('')

  useEffect(() => {
    if (!open) return
    setSettings(normalizeCodexAdvancedSettings(outerSettings))
  }, [open, outerSettings])

  useEffect(() => {
    if (!open) return

    const explicitCodex = String(settings.codexStartupPath || '').trim()
    const explicitOpenCode = String(settings.openCodeStartupPath || '').trim()

    if (explicitCodex) {
      setResolvedCodexStartupPath(explicitCodex)
    } else {
      const fallbackCodex = typeof svc?.getDefaultCodexAppPath === 'function'
        ? String(svc.getDefaultCodexAppPath() || '').trim()
        : ''
      setResolvedCodexStartupPath(fallbackCodex)
    }

    if (explicitOpenCode) {
      setResolvedOpenCodeStartupPath(explicitOpenCode)
    } else {
      const fallbackOpenCode = typeof svc?.getDefaultOpenCodeAppPath === 'function'
        ? String(svc.getDefaultOpenCodeAppPath() || '').trim()
        : ''
      setResolvedOpenCodeStartupPath(fallbackOpenCode)
    }
  }, [open, settings.codexStartupPath, settings.openCodeStartupPath, svc])

  useEffect(() => {
    if (!open) {
      // setShowAdvanced(false)
    }
  }, [open])

  const handleChange = (key, val) => {
    setSettings(prev => {
      const next = normalizeCodexAdvancedSettings({ ...prev, [key]: val })
      writeSharedSetting('codex_advanced_settings', next)
      onSettingsChange?.(next)
      return next
    })
  }

  const handlePickAppPath = async ({ key, title }) => {
    const files = await showOpenDialog({
      title,
      properties: ['openFile', 'openDirectory']
    })
    if (!files || !files[0]) return
    handleChange(key, files[0])
    toast.success('已更新启动路径')
  }

  const handleAutoDetectAppPath = ({ key, detectFn, emptyHint, successHint }) => {
    let detected = ''
    try {
      if (!svc || typeof detectFn !== 'function') {
        toast.warning('当前版本不支持自动探测')
        return
      }
      detected = detectFn('')
    } catch (e) {
      detected = ''
    }
    if (!detected) {
      toast.warning(emptyHint)
      return
    }
    handleChange(key, detected)
    toast.success(successHint)
  }

  const ToggleSwitch = ({ checked, onChange }) => (
    <label className="ag-switch">
      <input type="checkbox" checked={checked} onChange={onChange} />
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
        type="text"
        readOnly
        value={pathValue || ''}
        placeholder='未设置路径'
        className="settings-input"
        style={{ width: '100%', fontSize: 12, fontFamily: 'var(--font-mono)' }}
      />
    </div>
  )

  return (
    <Modal title='Codex 设置' open={open} onClose={onClose} contentClassName='settings-platform-modal'>
      <div className="settings-modal-content">
        {/* 基础设置内容 */}
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
              <div className="settings-label">显示 Code Review 配额</div>
              <div className="settings-desc">在统计概览中展示代码审查相关的使用进度。</div>
            </div>
            <ToggleSwitch 
              checked={settings.showCodeReviewQuota} 
              onChange={e => handleChange('showCodeReviewQuota', e.target.checked)} 
            />
          </div>
        </div>

        {/* IDE 交互设置 */}
        <div className="settings-section">
          <div className="settings-section-title">IDE 启动与协议同步</div>
          
          <div className="settings-row">
            <div className="settings-info">
              <div className="settings-label">切换时重启 Codex App</div>
              <div className="settings-desc">更新登录态后尝试通过协议唤起或重启客户端。</div>
            </div>
            <ToggleSwitch 
              checked={settings.autoRestartCodexApp} 
              onChange={e => handleChange('autoRestartCodexApp', e.target.checked)} 
            />
          </div>

          {settings.autoRestartCodexApp && (
            <>
              <div className="settings-row" style={{ paddingLeft: 12 }}>
                <div className="settings-info">
                  <div className="settings-label" style={{ fontSize: 13, fontWeight: 400 }}>若已关闭则自动启动</div>
                </div>
                <ToggleSwitch 
                  checked={settings.autoStartCodexAppWhenClosed} 
                  onChange={e => handleChange('autoStartCodexAppWhenClosed', e.target.checked)} 
                />
              </div>
              <div style={{ paddingLeft: 12 }}>
                <PathRow
                  label='Codex 启动路径'
                  pathValue={resolvedCodexStartupPath}
                  onPick={() => handlePickAppPath({ key: 'codexStartupPath', title: '选择 Codex App 路径' })}
                  onDetect={() => handleAutoDetectAppPath({
                    key: 'codexStartupPath',
                    detectFn: svc?.detectCodexAppPath,
                    emptyHint: '未探测到 Codex App，请手动选择',
                    successHint: '已自动探测 Codex App 路径'
                  })}
                />
              </div>
            </>
          )}

          <div className="settings-row" style={{ marginTop: 8 }}>
            <div className="settings-info">
              <div className="settings-label">自动重启 OpenCode</div>
              <div className="settings-desc">针对 OpenCode 版本的同步重启逻辑。</div>
            </div>
            <ToggleSwitch 
              checked={settings.autoRestartOpenCode} 
              onChange={e => handleChange('autoRestartOpenCode', e.target.checked)} 
            />
          </div>

          {settings.autoRestartOpenCode && (
            <>
              <div className="settings-row" style={{ paddingLeft: 12 }}>
                <div className="settings-info">
                  <div className="settings-label" style={{ fontSize: 13, fontWeight: 400 }}>若已关闭则自动启动</div>
                </div>
                <ToggleSwitch
                  checked={settings.autoStartOpenCodeWhenClosed}
                  onChange={e => handleChange('autoStartOpenCodeWhenClosed', e.target.checked)}
                />
              </div>
              <div style={{ paddingLeft: 12 }}>
                <PathRow
                  label='OpenCode 启动路径'
                  pathValue={resolvedOpenCodeStartupPath}
                  onPick={() => handlePickAppPath({ key: 'openCodeStartupPath', title: '选择 OpenCode 路径' })}
                  onDetect={() => handleAutoDetectAppPath({
                    key: 'openCodeStartupPath',
                    detectFn: () => svc?.detectOpenCodeAppPath?.('') || '',
                    emptyHint: '未探测到 OpenCode，请手动选择',
                    successHint: '已自动探测 OpenCode 路径'
                  })}
                />
              </div>
            </>
          )}

          <div className="settings-row" style={{ marginTop: 8 }}>
            <div className="settings-info">
              <div className="settings-label">同步覆盖 OpenCode 登录信息</div>
              <div className="settings-desc">同时更新 OpenCode 的登录凭证。</div>
            </div>
            <ToggleSwitch 
              checked={settings.overrideOpenCode} 
              onChange={e => handleChange('overrideOpenCode', e.target.checked)} 
            />
          </div>
        </div>

        {/* 自动切号 */}
        <div className="settings-section" style={{ borderBottom: 'none' }}>
          <div className="settings-section-title">自动切号控制</div>
          <div className="settings-row">
            <div className="settings-info">
              <div className="settings-label">启用自动切号</div>
              <div className="settings-desc">命中阈值后自动切换。注意：切换时会重启 IDE。</div>
            </div>
            <ToggleSwitch 
              checked={settings.autoSwitch} 
              onChange={e => handleChange('autoSwitch', e.target.checked)} 
            />
          </div>

          {settings.autoSwitch && (
            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 14, paddingLeft: 4 }}>
              <AutoSwitchThresholdSlider
                title='5小时配额阈值'
                description='当 5 小时剩余配额低于或等于该阈值时，尝试自动切换。'
                value={settings.autoSwitchHourlyThreshold}
                onChange={(nextValue) => handleChange('autoSwitchHourlyThreshold', nextValue)}
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
                title='周配额阈值'
                description='当每周剩余配额低于或等于该阈值时，尝试自动切换。'
                value={settings.autoSwitchWeeklyThreshold}
                onChange={(nextValue) => handleChange('autoSwitchWeeklyThreshold', nextValue)}
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
                <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>触发模型</span>
                <select className='settings-input' style={{ width: 140, background: 'var(--bg-surface)' }} value={settings.autoSwitchModelGroup} onChange={e => handleChange('autoSwitchModelGroup', e.target.value)}>
                  <option value='any'>任一模型</option>
                  <option value='codex'>Codex</option>
                  <option value='opencode'>OpenCode</option>
                </select>
              </div>
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}
