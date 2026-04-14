import React, { useState, useEffect } from 'react'
import Modal from '../../components/Modal'
import RefreshIntervalSlider from '../../components/RefreshIntervalSlider'
import AutoSwitchThresholdSlider from '../../components/AutoSwitchThresholdSlider'
import { normalizeGeminiAdvancedSettings } from '../../utils/gemini'
import { writeSharedSetting } from '../../utils/hostBridge.js'

export default function GeminiSettingsModal ({ open, onClose, toast, settings: outerSettings, onSettingsChange }) {
  const [settings, setSettings] = useState(() => normalizeGeminiAdvancedSettings(outerSettings))

  useEffect(() => {
    if (!open) return
    setSettings(normalizeGeminiAdvancedSettings(outerSettings))
  }, [open, outerSettings])

  const handleChange = (key, val) => {
    const next = normalizeGeminiAdvancedSettings({ ...settings, [key]: val })
    setSettings(next)
    writeSharedSetting('gemini_advanced_settings', next)
    onSettingsChange?.(next)
  }

  const ToggleSwitch = ({ checked, onChange }) => (
    <label className="ag-switch">
      <input type="checkbox" checked={checked} onChange={onChange} />
      <span className="ag-switch-slider" />
    </label>
  )

  return (
    <Modal title='Gemini 设置' open={open} onClose={onClose} contentClassName='settings-platform-modal'>
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
        </div>

        <div className="settings-section" style={{ borderBottom: 'none' }}>
          <div className="settings-section-title">系统级配额预警通知</div>
          <div className="settings-row">
            <div className="settings-info">
              <div className="settings-label">启用系统级预警</div>
              <div className="settings-desc">仅监控当前激活账号。命中阈值后发送宿主系统通知，点击可跳到 Gemini 页面。</div>
            </div>
            <ToggleSwitch
              checked={settings.quotaWarningEnabled}
              onChange={e => handleChange('quotaWarningEnabled', e.target.checked)}
            />
          </div>

          {settings.quotaWarningEnabled && (
            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 14, paddingLeft: 4 }}>
              <AutoSwitchThresholdSlider
                title='Pro 分组预警阈值'
                description='当前激活账号的 Pro 分组最小剩余配额低于或等于该阈值时发送系统通知。'
                value={settings.quotaWarningProThreshold}
                onChange={(nextValue) => handleChange('quotaWarningProThreshold', nextValue)}
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
                title='Flash 分组预警阈值'
                description='当前激活账号的 Flash 分组最小剩余配额低于或等于该阈值时发送系统通知。'
                value={settings.quotaWarningFlashThreshold}
                onChange={(nextValue) => handleChange('quotaWarningFlashThreshold', nextValue)}
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
    </Modal>
  )
}
