import { useEffect, useState } from 'react'
import { useToast } from '../../components/Toast'
import { copyText, readSharedSetting, writeSharedSetting, writeConfigFile, readConfigFile, getHostApi, getPlatformInfo } from '../../utils/hostBridge.js'
import { CopyIcon, CheckIcon } from '../../components/Icons/ActionIcons'

export default function SettingsPersonalize () {
  const [personality, setPersonality] = useState('务实')
  const [instruction, setInstruction] = useState('')
  const [copied, setCopied] = useState(false)
  const [selectedApp, setSelectedApp] = useState('')
  const [hasBackup, setHasBackup] = useState(false)
  const toast = useToast()

  const apps = [
    { id: 'gemini', name: 'Gemini', configPath: '~/.gemini/GEMINI.md' },
    { id: 'codex', name: 'Codex', configPath: '~/.codex/AGENTS.md' },
    { id: 'claude', name: 'Claude', configPath: '~/.claude/CLAUDE.md' },
    { id: 'opencode', name: 'OpenCode', configPath: '~/.config/opencode/AGENTS.md' }
  ]

  useEffect(() => {
    const stored = readSharedSetting('ai_custom_instructions', null)
    if (stored) {
      setInstruction(stored.text || '')
      setPersonality(stored.personality || '务实')
    }
  }, [])

  useEffect(() => {
    if (!selectedApp) {
      setHasBackup(false)
      return
    }
    const app = apps.find(a => a.id === selectedApp)
    const platform = getPlatformInfo()
    const host = getHostApi()
    const configPath = app.configPath.replace('~', platform.getHomeDir())
    const backupPath = configPath + '.aideck.bak'

    try {
      const backupExists = host.fileExists(backupPath)
      setHasBackup(backupExists)
    } catch (err) {
      setHasBackup(false)
    }
  }, [selectedApp])

  const handleSave = () => {
    writeSharedSetting('ai_custom_instructions', { text: instruction, personality })
    toast.success('自定义指令已保存')
  }

  const handleCopy = async () => {
    const ok = await copyText(instruction)
    if (ok) {
      setCopied(true)
      toast.success('已复制到剪贴板')
      setTimeout(() => setCopied(false), 2000)
    } else {
      toast.warning('复制失败，请手动复制')
    }
  }

  const handleRestore = async () => {
    const app = apps.find(a => a.id === selectedApp)
    const platform = getPlatformInfo()
    const host = getHostApi()
    const configPath = app.configPath.replace('~', platform.getHomeDir())
    const backupPath = configPath + '.aideck.bak'

    try {
      const backupContent = readConfigFile(backupPath)
      if (backupContent == null) {
        toast.warning('备份文件不存在')
        return
      }
      writeConfigFile(configPath, backupContent)
      const ok = host.deleteFile(backupPath)
      if (!ok) {
        toast.warning('删除备份文件失败，但还原已完成')
      }
      toast.success(`${app.name} 已还原到备份版本`)
      setHasBackup(false)
    } catch (err) {
      toast.error(`还原失败：${err.message}`)
    }
  }

  const handleApplyToApp = async () => {
    if (!selectedApp) {
      toast.warning('请选择应用')
      return
    }
    const app = apps.find(a => a.id === selectedApp)
    const platform = getPlatformInfo()
    const host = getHostApi()

    try {
      const configPath = app.configPath.replace('~', platform.getHomeDir())
      const dirPath = configPath.substring(0, configPath.lastIndexOf('/'))

      if (!host.dirExists(dirPath)) {
        toast.warning(`${app.name}配置目录不存在，请复制内容手动添加`)
        return
      }

      const existingContent = readConfigFile(configPath)
      if (existingContent != null && existingContent.trim() === instruction.trim()) {
        toast.success(`${app.name}已是当前配置`)
        return
      }

      await writeConfigFile(app.configPath, instruction)
      toast.success(`${app.name} 设置完成`)
      setHasBackup(true)
    } catch (err) {
      if (err.message.includes('配置目录不存在')) {
        toast.warning(`${app.name}配置目录不存在，请复制内容手动添加`)
      } else {
        toast.error(`设置失败：${err.message}`)
      }
    }
  }

  return (
    <div className='settings-panel'>
      <h2 className='settings-h2'>个性化</h2>
      <div className='settings-card' style={{ display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 24px', borderBottom: '1px solid var(--border-default)', fontSize: '14px', fontWeight: 500, color: 'var(--text-primary)' }}>
          <span>自定义指令</span>
        </div>
        <div style={{ padding: '24px' }}>
          <textarea
            className='settings-textarea'
            value={instruction}
            onChange={e => setInstruction(e.target.value)}
            spellCheck={false}
            placeholder='请填写自定义指令以便应用到各个平台'
          />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 24px', borderTop: '1px solid var(--border-default)', backgroundColor: 'var(--bg-secondary)' }}>
          <div style={{ display: 'flex', gap: 8 }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <select
              value={selectedApp}
              onChange={e => setSelectedApp(e.target.value)}
              style={{ padding: '6px 12px', fontSize: 13, borderRadius: 4, border: '1px solid var(--border-default)', backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}
            >
              <option value=''>选择应用</option>
              {apps.map(app => (
                <option key={app.id} value={app.id}>{app.name}</option>
              ))}
            </select>
            {hasBackup && (
              <button className='btn btn-secondary' onClick={handleRestore} style={{ padding: '4px 12px', fontSize: 13 }}>
                还原设置
              </button>
            )}
            <button className='btn btn-sm' onClick={handleApplyToApp} style={{ padding: '4px 12px', fontSize: 13 }}>
              设置
            </button>
            <button className='btn btn-sm' onClick={handleCopy} style={{ padding: '4px 12px', fontSize: 13, display: 'flex', alignItems: 'center' }}>
              {copied ? <CheckIcon size={12} style={{ marginRight: 4 }} stroke='#10b981' /> : <CopyIcon size={12} style={{ marginRight: 4 }} />}
              复制
            </button>
            <button className='btn btn-primary' onClick={handleSave} style={{ fontSize: 13 }}>
              保存
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
