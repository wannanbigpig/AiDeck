import { getCommandStatus, launchCliCommand, showOpenDialog } from '../utils/hostBridge.js'
import { readGlobalSettings } from '../utils/globalSettings.js'

const INSTALL_HINTS = {
  codex: 'npm install -g @openai/codex',
  gemini: 'npm install -g @google/gemini-cli'
}

export async function launchPlatformCli ({
  platform,
  command,
  account,
  activate,
  refresh,
  toast,
  notice,
  onActivity
}) {
  const cliCommand = String(command || platform || '').trim()
  const status = getCommandStatus(cliCommand)
  if (!status.available) {
    const installCommand = status.installCommand || INSTALL_HINTS[cliCommand] || ''
    if (notice?.show) {
      notice.show({
        title: `未检测到 ${cliCommand} CLI`,
        message: '请先安装命令行工具后再启动。',
        detail: '安装完成后重新点击 CLI 按钮，选择目录即可在默认终端中运行。',
        command: installCommand,
        tone: 'warning'
      })
    } else {
      toast?.warning?.(`未检测到 ${cliCommand} CLI，请先安装：${installCommand}`, 9000)
    }
    return false
  }

  const picked = await showOpenDialog({
    title: `选择 ${cliCommand} CLI 工作目录`,
    properties: ['openDirectory']
  })
  const cwd = Array.isArray(picked) && picked[0] ? String(picked[0]) : ''
  if (!cwd) return false

  const activated = await Promise.resolve(activate?.(account))
  if (!activated) return false

  const settings = readGlobalSettings()
  const result = await launchCliCommand({
    command: cliCommand,
    cwd,
    terminal: settings.defaultTerminal || 'system'
  })

  if (!result || !result.success) {
    toast?.error?.((result && result.error) || '打开终端失败')
    return false
  }

  refresh?.()
  toast?.success?.(result.message || `已启动 ${cliCommand} CLI`)
  onActivity?.(`${cliCommand} CLI -> ${account?.email || account?.id || cwd}`)
  return true
}
