import React, { useState, useEffect } from 'react'
import Modal from '../../components/Modal'
import {
  ChevronDownIcon, 
  ChevronUpIcon 
} from '../../components/Icons/ActionIcons'
import RefreshIntervalSlider from '../../components/RefreshIntervalSlider'
import { writeSharedSetting } from '../../utils/hostBridge.js'

export default function GeminiSettingsModal ({ open, onClose, toast, settings: outerSettings, onSettingsChange }) {
  const [settings, setSettings] = useState(outerSettings)

  useEffect(() => {
    if (!open) return
    setSettings(outerSettings)
  }, [open, outerSettings])

  const handleChange = (key, val) => {
    const next = { ...settings, [key]: val }
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

        {/* 高级设置面板 */}
        <div className="settings-section" style={{ borderBottom: 'none' }}>
          <div style={{ color: 'var(--text-muted)', fontSize: 12, lineHeight: 1.6, padding: '8px 0' }}>
            Gemini 模块目前专注于配额监控。自动备份、批量导出策略等高级功能正在规划中，敬请期待。
          </div>
        </div>
      </div>
    </Modal>
  )
}
