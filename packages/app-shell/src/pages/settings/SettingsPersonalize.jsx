import { useEffect, useState } from 'react'
import { useToast } from '../../components/Toast'
import { copyText, readSharedSetting, writeSharedSetting } from '../../utils/hostBridge.js'
import { CopyIcon, CheckIcon } from '../../components/Icons/ActionIcons'

export default function SettingsPersonalize () {
  const [personality, setPersonality] = useState('务实')
  const [instruction, setInstruction] = useState('')
  const [copied, setCopied] = useState(false)
  const toast = useToast()

  useEffect(() => {
    const stored = readSharedSetting('ai_custom_instructions', null)
    if (stored) {
      setInstruction(stored.text || '')
      setPersonality(stored.personality || '务实')
      return
    }
    setInstruction('# Always respond in 中文\n\n# 毛泽东思想指导下的工程实践\n\n> "没有调查就没有发言权。" —— 编码之前，先读懂代码库。')
  }, [])

  const handleSave = () => {
    writeSharedSetting('ai_custom_instructions', { text: instruction, personality })
    toast.success('自定义指令已保存')
  }

  const handleCopy = async () => {
    const ok = await copyText(`[${personality}模式]\n${instruction}`)
    if (ok) {
      setCopied(true)
      toast.success('已复制到剪贴板')
      setTimeout(() => setCopied(false), 2000)
    } else {
      toast.warning('复制失败，请手动复制')
    }
  }

  return (
    <div className='settings-panel'>
      <h2 className='settings-h2'>个性化</h2>
      <div className='settings-card' style={{ display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 24px', borderBottom: '1px solid var(--border-default)', fontSize: '14px', fontWeight: 500, color: 'var(--text-primary)' }}>
          <span>自定义指令</span>
          <button className='btn btn-sm' onClick={handleCopy} style={{ padding: '4px 8px', fontSize: 12, display: 'flex', alignItems: 'center' }}>
            {copied ? <CheckIcon size={12} style={{ marginRight: 4 }} stroke='#10b981' /> : <CopyIcon size={12} style={{ marginRight: 4 }} />}
            复制
          </button>
        </div>
        <div style={{ padding: '24px', position: 'relative' }}>
          <textarea className='settings-textarea' value={instruction} onChange={e => setInstruction(e.target.value)} spellCheck={false} />
          <button className='btn btn-primary' style={{ position: 'absolute', bottom: 40, right: 40 }} onClick={handleSave}>
            保存
          </button>
        </div>
      </div>
    </div>
  )
}
