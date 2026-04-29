import { getCommandStatus, launchCliCommand, showOpenDialog } from '../utils/hostBridge.js'
import { readGlobalSettings } from '../utils/globalSettings.js'

const INSTALL_HINTS = {
  codex: 'npm install -g @openai/codex',
  gemini: 'npm install -g @google/gemini-cli'
}

export async function launchPlatformCli ({
  platform,
  command,
  commandPath,
  account,
  activate,
  refresh,
  toast,
  notice,
  onActivity
}) {
  const cliCommand = String(commandPath || command || platform || '').trim()
  const cliName = String(command || platform || '').trim()
  const status = getCommandStatus(cliCommand)
  if (!status.available) {
    const installCommand = status.installCommand || INSTALL_HINTS[cliName] || ''
    if (notice?.show) {
      notice.show({
        title: `未检测到 ${cliName || cliCommand} CLI`,
        message: '请先安装命令行工具后再启动。',
        detail: '安装完成后重新点击 CLI 按钮，选择目录即可在默认终端中运行。',
        command: installCommand,
        tone: 'warning'
      })
    } else {
      toast?.warning?.(`未检测到 ${cliName || cliCommand} CLI，请先安装：${installCommand}`, 9000)
    }
    return false
  }

  const picked = await showOpenDialog({
    title: `选择 ${cliName || cliCommand} CLI 工作目录`,
    properties: ['openDirectory']
  })
  const cwd = Array.isArray(picked) && picked[0] ? String(picked[0]) : ''
  if (!cwd) return false

  const launchContext = typeof activate === 'function'
    ? await Promise.resolve(activate(account))
    : { success: true }
  if (!launchContext) return false
  if (launchContext && typeof launchContext === 'object' && launchContext.success === false) {
    toast?.error?.(launchContext.error || '准备 CLI 启动失败')
    return false
  }

  const settings = readGlobalSettings()
  const result = await launchCliCommand({
    command: cliCommand,
    cwd,
    terminal: settings.defaultTerminal || 'system',
    env: launchContext && typeof launchContext === 'object' ? launchContext.env : undefined,
    args: launchContext && typeof launchContext === 'object' ? launchContext.args : undefined
  })

  if (!result || !result.success) {
    toast?.error?.((result && result.error) || '打开终端失败')
    return false
  }

  refresh?.()
  if (Array.isArray(launchContext?.warnings) && launchContext.warnings.length > 0) {
    toast?.warning?.(launchContext.warnings[0])
  }
  toast?.success?.(result.message || `已启动 ${cliCommand} CLI`)
  onActivity?.(`${cliName || cliCommand} CLI -> ${account?.email || account?.id || cwd}`)
  return true
}
