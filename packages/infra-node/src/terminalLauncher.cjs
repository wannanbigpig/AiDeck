const fs = require('fs')
const os = require('os')
const path = require('path')
const childProcess = require('child_process')

function shellQuote (value) {
  return "'" + String(value || '').replace(/'/g, "'\\''") + "'"
}

function escapeAppleScript (value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
}

function escapePowerShellSingleQuoted (value) {
  return String(value || '').replace(/'/g, "''")
}

function normalizeTerminal (value) {
  const raw = String(value || '').trim()
  return raw || 'system'
}

function pushUniqueDir (dirs, dir) {
  const value = String(dir || '').trim()
  if (!value) return
  if (dirs.includes(value)) return
  dirs.push(value)
}

function collectPathDirs () {
  const raw = String(process.env.PATH || '')
  return raw.split(path.delimiter).filter(Boolean)
}

function appendHomeCliDirs (dirs) {
  const home = os.homedir()
  if (!home) return
  const staticDirs = [
    '.npm-global/bin',
    '.npm/bin',
    '.local/bin',
    '.cargo/bin',
    '.volta/bin',
    '.yarn/bin',
    '.bun/bin',
    'Library/pnpm',
    'bin'
  ]
  for (const dir of staticDirs) {
    pushUniqueDir(dirs, path.join(home, dir))
  }

  const nvmVersionsDir = path.join(home, '.nvm/versions/node')
  try {
    for (const version of fs.readdirSync(nvmVersionsDir)) {
      pushUniqueDir(dirs, path.join(nvmVersionsDir, version, 'bin'))
    }
  } catch (err) {}

  const fnmVersionsDir = path.join(home, '.fnm/node-versions')
  try {
    for (const version of fs.readdirSync(fnmVersionsDir)) {
      pushUniqueDir(dirs, path.join(fnmVersionsDir, version, 'installation/bin'))
    }
  } catch (err) {}
}

function appendPlatformCliDirs (dirs) {
  if (process.platform === 'darwin') {
    for (const dir of [
      '/opt/homebrew/bin',
      '/opt/homebrew/sbin',
      '/usr/local/bin',
      '/usr/local/sbin'
    ]) {
      pushUniqueDir(dirs, dir)
    }
    appendHomeCliDirs(dirs)
    return
  }

  if (process.platform === 'win32') {
    if (process.env.APPDATA) {
      pushUniqueDir(dirs, path.join(process.env.APPDATA, 'npm'))
    }
    return
  }

  appendHomeCliDirs(dirs)
}

function collectRuntimeSearchDirs () {
  const dirs = collectPathDirs()
  appendPlatformCliDirs(dirs)
  return dirs
}

function getCommandCandidates (commandName) {
  const name = String(commandName || '').trim()
  if (!name) return []
  if (process.platform !== 'win32') return [name]
  const ext = path.extname(name)
  if (ext) return [name]
  const pathext = String(process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM')
    .split(';')
    .map(item => item.trim().toLowerCase())
    .filter(Boolean)
  return [name, ...pathext.map(item => name + item)]
}

function resolveCommandPath (commandName) {
  const name = String(commandName || '').trim()
  if (!name) return ''

  if (path.isAbsolute(name) || name.includes('/') || name.includes('\\')) {
    return fs.existsSync(name) && fs.statSync(name).isFile() ? name : ''
  }

  for (const dir of collectRuntimeSearchDirs()) {
    for (const candidate of getCommandCandidates(name)) {
      const filePath = path.join(dir, candidate)
      try {
        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
          return filePath
        }
      } catch (err) {}
    }
  }

  return ''
}

function commandExists (commandName) {
  const name = String(commandName || '').trim()
  if (!name) return false
  if (resolveCommandPath(name)) return true

  try {
    if (process.platform === 'win32') {
      const result = childProcess.spawnSync('where', [name], { stdio: 'ignore', windowsHide: true })
      return result.status === 0
    }
    const result = childProcess.spawnSync('sh', ['-lc', 'command -v ' + shellQuote(name)], { stdio: 'ignore' })
    return result.status === 0
  } catch (err) {
    return false
  }
}

function getCliInstallCommand (cliName) {
  const name = String(cliName || '').trim().toLowerCase()
  if (name === 'codex') return 'npm install -g @openai/codex'
  if (name === 'gemini') return 'npm install -g @google/gemini-cli'
  return ''
}

function getCommandStatus (commandName) {
  const name = String(commandName || '').trim()
  return {
    command: name,
    available: commandExists(name),
    path: resolveCommandPath(name),
    installCommand: getCliInstallCommand(name)
  }
}

function buildMacTerminalCandidates () {
  const home = os.homedir()
  return [
    {
      value: 'Terminal',
      label: 'Terminal.app',
      paths: [
        '/System/Applications/Utilities/Terminal.app',
        '/Applications/Utilities/Terminal.app'
      ]
    },
    {
      value: 'iTerm2',
      label: 'iTerm2',
      paths: [
        '/Applications/iTerm.app',
        '/Applications/iTerm 2.app',
        path.join(home, 'Applications/iTerm.app'),
        path.join(home, 'Applications/iTerm 2.app')
      ]
    },
    {
      value: 'Warp',
      label: 'Warp',
      paths: [
        '/Applications/Warp.app',
        path.join(home, 'Applications/Warp.app')
      ]
    },
    {
      value: 'Ghostty',
      label: 'Ghostty',
      paths: [
        '/Applications/Ghostty.app',
        path.join(home, 'Applications/Ghostty.app')
      ]
    },
    {
      value: 'WezTerm',
      label: 'WezTerm',
      paths: [
        '/Applications/WezTerm.app',
        path.join(home, 'Applications/WezTerm.app')
      ]
    },
    {
      value: 'Kitty',
      label: 'Kitty',
      paths: [
        '/Applications/kitty.app',
        '/Applications/Kitty.app',
        path.join(home, 'Applications/kitty.app'),
        path.join(home, 'Applications/Kitty.app')
      ]
    },
    {
      value: 'Alacritty',
      label: 'Alacritty',
      paths: [
        '/Applications/Alacritty.app',
        path.join(home, 'Applications/Alacritty.app')
      ]
    },
    {
      value: 'Tabby',
      label: 'Tabby',
      paths: [
        '/Applications/Tabby.app',
        path.join(home, 'Applications/Tabby.app')
      ]
    },
    {
      value: 'Hyper',
      label: 'Hyper',
      paths: [
        '/Applications/Hyper.app',
        path.join(home, 'Applications/Hyper.app')
      ]
    }
  ]
}

function getAvailableTerminals () {
  const items = [{ value: 'system', label: '系统默认' }]

  if (process.platform === 'darwin') {
    for (const item of buildMacTerminalCandidates()) {
      if (item.paths.some(candidate => candidate && fs.existsSync(candidate))) {
        items.push({ value: item.value, label: item.label })
      }
    }
    return items
  }

  if (process.platform === 'win32') {
    const candidates = [
      { value: 'cmd', label: 'Command Prompt' },
      { value: 'powershell', label: 'PowerShell' },
      { value: 'pwsh', label: 'PowerShell 7' },
      { value: 'wt', label: 'Windows Terminal' }
    ]
    for (const item of candidates) {
      if (commandExists(item.value)) items.push(item)
    }
    return items
  }

  const candidates = [
    { value: 'x-terminal-emulator', label: '系统终端' },
    { value: 'gnome-terminal', label: 'GNOME Terminal' },
    { value: 'konsole', label: 'Konsole' },
    { value: 'xfce4-terminal', label: 'XFCE Terminal' },
    { value: 'xterm', label: 'xterm' },
    { value: 'alacritty', label: 'Alacritty' },
    { value: 'kitty', label: 'Kitty' }
  ]
  for (const item of candidates) {
    if (commandExists(item.value)) items.push(item)
  }
  return items
}

function resolveMacTerminalApp (terminal) {
  const normalized = normalizeTerminal(terminal)
  if (normalized === 'system' || normalized === 'Terminal') return { kind: 'terminal', appName: 'Terminal' }
  if (normalized.toLowerCase().includes('iterm')) return { kind: 'iterm', appName: 'iTerm' }
  return { kind: 'unsupported', appName: normalized }
}

function launchOnMac (command, terminal) {
  const target = resolveMacTerminalApp(terminal)
  const escaped = escapeAppleScript(command)
  let script = ''

  if (target.kind === 'iterm') {
    script = `
      tell application "iTerm"
        activate
        if not (exists window 1) then
          create window with default profile
          tell current session of current window
            write text "${escaped}"
          end tell
        else
          tell current window
            create tab with default profile
            tell current session
              write text "${escaped}"
            end tell
          end tell
        end if
      end tell
    `
  } else if (target.kind === 'terminal') {
    script = `
      tell application "Terminal"
        activate
        do script "${escaped}"
      end tell
    `
  } else {
    return {
      success: false,
      error: `当前终端暂不支持直接执行：${target.appName}。请改用 Terminal 或 iTerm2。`
    }
  }

  const result = childProcess.spawnSync('osascript', ['-e', script], { encoding: 'utf8' })
  if (result.status !== 0) {
    return {
      success: false,
      error: `打开终端失败 (${target.appName}): ${String(result.stderr || '').trim() || '未知错误'}`
    }
  }
  return { success: true, message: `已在 ${target.appName} 执行命令` }
}

function launchOnWindows (command, terminal, cwd, commandName, executableCommand) {
  const selected = normalizeTerminal(terminal)
  let executable = 'cmd'
  let args = ['/C', 'start', '', 'cmd', '/K', command]
  const powershellCommand = "Set-Location -LiteralPath '" + escapePowerShellSingleQuoted(cwd) + "'; & '" + escapePowerShellSingleQuoted(executableCommand || commandName) + "'"

  if (selected === 'powershell') {
    executable = 'powershell'
    args = ['-NoExit', '-Command', powershellCommand]
  } else if (selected === 'pwsh') {
    executable = 'pwsh'
    args = ['-NoExit', '-Command', powershellCommand]
  } else if (selected === 'wt') {
    executable = 'wt'
    args = ['cmd', '/K', command]
  }

  try {
    childProcess.spawn(executable, args, { detached: true, stdio: 'ignore', windowsHide: false }).unref()
    return { success: true, message: '已在终端执行命令' }
  } catch (err) {
    return { success: false, error: `打开终端失败: ${err && err.message ? err.message : String(err)}` }
  }
}

function launchOnLinux (command, terminal) {
  const selected = normalizeTerminal(terminal)
  const executable = selected === 'system' ? 'x-terminal-emulator' : selected
  const argsByTerminal = {
    'gnome-terminal': ['--', 'bash', '-lc', command + '; exec bash'],
    konsole: ['-e', 'bash', '-lc', command + '; exec bash'],
    'xfce4-terminal': ['--hold', '-e', command],
    xterm: ['-hold', '-e', command],
    alacritty: ['-e', 'bash', '-lc', command + '; exec bash'],
    kitty: ['bash', '-lc', command + '; exec bash'],
    'x-terminal-emulator': ['-e', 'bash', '-lc', command + '; exec bash']
  }
  const args = argsByTerminal[executable] || ['-e', 'bash', '-lc', command + '; exec bash']

  try {
    childProcess.spawn(executable, args, { detached: true, stdio: 'ignore' }).unref()
    return { success: true, message: '已在终端执行命令' }
  } catch (err) {
    return { success: false, error: `打开终端失败: ${err && err.message ? err.message : String(err)}` }
  }
}

function launchCliCommand (payload) {
  const commandName = String(payload && payload.command ? payload.command : '').trim()
  const cwd = String(payload && payload.cwd ? payload.cwd : '').trim()
  const terminal = normalizeTerminal(payload && payload.terminal)

  if (!commandName) return { success: false, error: 'CLI 命令为空' }
  if (!cwd || !fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
    return { success: false, error: '目录不存在或不可访问' }
  }
  const resolvedCommandPath = resolveCommandPath(commandName)
  if (!resolvedCommandPath && !commandExists(commandName)) {
    return {
      success: false,
      error: `未检测到 ${commandName} CLI，请先安装：${getCliInstallCommand(commandName)}`,
      installCommand: getCliInstallCommand(commandName)
    }
  }
  const executableCommand = resolvedCommandPath || commandName

  const shellCommand = process.platform === 'win32'
    ? 'cd /d "' + cwd.replace(/"/g, '\\"') + '" && "' + executableCommand.replace(/"/g, '\\"') + '"'
    : 'cd ' + shellQuote(cwd) + ' && ' + shellQuote(executableCommand)
  if (process.platform === 'darwin') return launchOnMac(shellCommand, terminal)
  if (process.platform === 'win32') return launchOnWindows(shellCommand, terminal, cwd, commandName, executableCommand)
  return launchOnLinux(shellCommand, terminal)
}

module.exports = {
  commandExists,
  resolveCommandPath,
  collectRuntimeSearchDirs,
  getCommandStatus,
  getCliInstallCommand,
  getAvailableTerminals,
  launchCliCommand
}
