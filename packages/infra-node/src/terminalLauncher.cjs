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

function normalizeEnvAssignments (env) {
  if (!env || typeof env !== 'object') return []
  const entries = []
  for (const key of Object.keys(env)) {
    const name = String(key || '').trim()
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) continue
    const value = env[key]
    if (value == null) continue
    entries.push([name, String(value)])
  }
  return entries
}

function normalizeArgs (args) {
  if (!Array.isArray(args)) return []
  return args
    .map(item => String(item || '').trim())
    .filter(Boolean)
}

function pushUniqueDir (dirs, dir) {
  const value = String(dir || '').trim()
  if (!value) return
  if (dirs.includes(value)) return
  dirs.push(value)
}

function resolveRuntimePlatform (runtime) {
  return runtime && runtime.platform ? runtime.platform : process.platform
}

function resolveRuntimeEnv (runtime) {
  return runtime && runtime.env && typeof runtime.env === 'object' ? runtime.env : process.env
}

function resolveRuntimeHomeDir (runtime) {
  if (runtime && runtime.homeDir) return String(runtime.homeDir)
  return os.homedir()
}

function resolveRuntimePathDelimiter (runtime) {
  return resolveRuntimePlatform(runtime) === 'win32' ? ';' : ':'
}

function collectPathDirs (runtime) {
  const env = resolveRuntimeEnv(runtime)
  const raw = String(env.PATH || env.Path || env.path || '')
  return raw.split(resolveRuntimePathDelimiter(runtime)).filter(Boolean)
}

function appendHomeCliDirs (dirs, homeDir) {
  const home = homeDir || os.homedir()
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

function appendWindowsCliDirs (dirs, env, homeDir) {
  if (env.APPDATA) pushUniqueDir(dirs, path.join(env.APPDATA, 'npm'))
  if (env.LOCALAPPDATA) {
    pushUniqueDir(dirs, path.join(env.LOCALAPPDATA, 'Programs', 'nodejs'))
    pushUniqueDir(dirs, path.join(env.LOCALAPPDATA, 'Yarn', 'bin'))
    pushUniqueDir(dirs, path.join(env.LOCALAPPDATA, 'pnpm'))
  }
  if (env.ProgramFiles) pushUniqueDir(dirs, path.join(env.ProgramFiles, 'nodejs'))
  if (env['ProgramFiles(x86)']) pushUniqueDir(dirs, path.join(env['ProgramFiles(x86)'], 'nodejs'))
  if (env.ProgramData) pushUniqueDir(dirs, path.join(env.ProgramData, 'chocolatey', 'bin'))
  if (env.NVM_HOME) pushUniqueDir(dirs, env.NVM_HOME)
  if (env.NVM_SYMLINK) pushUniqueDir(dirs, env.NVM_SYMLINK)
  if (homeDir) {
    pushUniqueDir(dirs, path.join(homeDir, 'scoop', 'shims'))
    pushUniqueDir(dirs, path.join(homeDir, '.volta', 'bin'))
    pushUniqueDir(dirs, path.join(homeDir, '.bun', 'bin'))
  }
}

function appendPlatformCliDirs (dirs, runtime) {
  const platform = resolveRuntimePlatform(runtime)
  const env = resolveRuntimeEnv(runtime)
  const homeDir = resolveRuntimeHomeDir(runtime)

  if (platform === 'darwin') {
    for (const dir of [
      '/opt/homebrew/bin',
      '/opt/homebrew/sbin',
      '/usr/local/bin',
      '/usr/local/sbin'
    ]) {
      pushUniqueDir(dirs, dir)
    }
    appendHomeCliDirs(dirs, homeDir)
    return
  }

  if (platform === 'win32') {
    appendWindowsCliDirs(dirs, env, homeDir)
    return
  }

  for (const dir of [
    '/usr/local/bin',
    '/usr/local/sbin',
    '/usr/bin',
    '/bin',
    '/snap/bin',
    '/var/lib/flatpak/exports/bin'
  ]) {
    pushUniqueDir(dirs, dir)
  }
  appendHomeCliDirs(dirs, homeDir)
}

function collectRuntimeSearchDirs (runtime) {
  const dirs = collectPathDirs(runtime)
  appendPlatformCliDirs(dirs, runtime)
  return dirs
}

function buildRuntimePath (runtime, leadingDirs) {
  const dirs = []
  if (Array.isArray(leadingDirs)) {
    for (const dir of leadingDirs) {
      pushUniqueDir(dirs, dir)
    }
  }
  for (const dir of collectRuntimeSearchDirs(runtime)) {
    pushUniqueDir(dirs, dir)
  }
  return dirs.join(resolveRuntimePathDelimiter(runtime))
}

function buildRuntimeEnv (env, runtime) {
  const extra = env && typeof env === 'object' ? env : {}
  const baseEnv = resolveRuntimeEnv(runtime)
  const extraPath = String(extra.PATH || extra.Path || extra.path || '')
  const leadingDirs = extraPath
    ? extraPath.split(resolveRuntimePathDelimiter(runtime)).filter(Boolean)
    : []
  return Object.assign({}, baseEnv, extra, {
    PATH: buildRuntimePath(runtime, leadingDirs)
  })
}

function buildCliLaunchEnv (executableCommand, env, runtime) {
  const extra = env && typeof env === 'object' ? env : {}
  const delimiter = resolveRuntimePathDelimiter(runtime)
  const isAbsoluteCommand = path.isAbsolute(String(executableCommand || ''))
  const commandDir = isAbsoluteCommand ? path.dirname(String(executableCommand)) : ''
  const extraPath = String(extra.PATH || extra.Path || extra.path || '')
  const leadingDirs = []
  if (commandDir && extraPath) leadingDirs.push(commandDir)
  if (extraPath) leadingDirs.push(...extraPath.split(delimiter).filter(Boolean))

  const launchEnv = {}
  if (!isAbsoluteCommand || extraPath) {
    launchEnv.PATH = buildRuntimePath(runtime, leadingDirs)
  }
  for (const key of Object.keys(extra)) {
    if (key === 'PATH' || key === 'Path' || key === 'path') continue
    launchEnv[key] = extra[key]
  }
  return launchEnv
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

function resolveCommandPath (commandName, runtime) {
  const name = String(commandName || '').trim()
  if (!name) return ''

  if (path.isAbsolute(name) || name.includes('/') || name.includes('\\')) {
    return fs.existsSync(name) && fs.statSync(name).isFile() ? name : ''
  }

  for (const dir of collectRuntimeSearchDirs(runtime)) {
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

function commandExists (commandName, runtime) {
  const name = String(commandName || '').trim()
  if (!name) return false
  if (resolveCommandPath(name, runtime)) return true
  if (runtime && Object.prototype.hasOwnProperty.call(runtime, 'env')) return false

  try {
    if (resolveRuntimePlatform(runtime) === 'win32') {
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

function readCommandVersion (commandPath, runtime) {
  const target = String(commandPath || '').trim()
  if (!target) return { success: false, version: '', error: 'CLI 命令为空' }
  const commandDir = path.isAbsolute(target) ? path.dirname(target) : ''
  try {
    const result = childProcess.spawnSync(target, ['--version'], {
      env: buildRuntimeEnv(commandDir ? { PATH: commandDir } : {}, runtime),
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true
    })
    if (result.error) {
      return { success: false, version: '', error: result.error.message || String(result.error) }
    }
    const version = String(result.stdout || result.stderr || '').trim().split(/\r?\n/).map(line => line.trim()).filter(Boolean)[0] || ''
    if (result.status === 0 && version) {
      return { success: true, version, error: null }
    }
    return {
      success: false,
      version,
      error: version || ('读取版本失败: ' + result.status)
    }
  } catch (err) {
    return { success: false, version: '', error: err && err.message ? err.message : String(err) }
  }
}

function getCommandStatus (commandName, runtime) {
  const name = String(commandName || '').trim()
  const commandPath = resolveCommandPath(name, runtime)
  const available = commandExists(name, runtime)
  const versionResult = available ? readCommandVersion(commandPath || name, runtime) : null
  return {
    command: name,
    available,
    path: commandPath,
    installCommand: getCliInstallCommand(name),
    version: versionResult && versionResult.success ? versionResult.version : '',
    versionError: versionResult && !versionResult.success ? versionResult.error : ''
  }
}

function getCommandVersion (commandName, runtime) {
  const name = String(commandName || '').trim()
  if (!name) return { success: false, command: name, version: '', error: 'CLI 命令为空' }
  const status = getCommandStatus(name, runtime)
  if (!status.available) {
    return {
      success: false,
      command: name,
      version: '',
      error: `未检测到 ${name} CLI`
    }
  }
  const commandPath = String(status.path || name).trim()
  const versionResult = readCommandVersion(commandPath, runtime)
  return Object.assign({ command: name, path: commandPath }, versionResult)
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

function launchOnWindows (command, terminal, cwd, commandName, executableCommand, payload) {
  const selected = normalizeTerminal(terminal)
  let executable = 'cmd'
  let args = ['/C', 'start', '', 'cmd', '/K', command]
  const envEntries = normalizeEnvAssignments(payload && payload.env)
  const cliArgs = normalizeArgs(payload && payload.args)
  const powershellEnv = envEntries
    .map(([key, value]) => "$env:" + key + "='" + escapePowerShellSingleQuoted(value) + "'")
    .join('; ')
  const powershellArgs = cliArgs
    .map(arg => "'" + escapePowerShellSingleQuoted(arg) + "'")
    .join(' ')
  const powershellCommand = [
    powershellEnv,
    "Set-Location -LiteralPath '" + escapePowerShellSingleQuoted(cwd) + "'",
    "& '" + escapePowerShellSingleQuoted(executableCommand || commandName) + "'" + (powershellArgs ? ' ' + powershellArgs : '')
  ].filter(Boolean).join('; ')

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

function buildShellCommand (payload) {
  const commandName = String(payload && payload.commandName ? payload.commandName : '').trim()
  const executableCommand = String(payload && payload.executableCommand ? payload.executableCommand : commandName).trim()
  const cwd = String(payload && payload.cwd ? payload.cwd : '').trim()
  const envEntries = normalizeEnvAssignments(payload && payload.env)
  const args = normalizeArgs(payload && payload.args)

  if (process.platform === 'win32') {
    const escapedCwd = cwd.replace(/"/g, '\\"')
    const escapedExecutable = executableCommand.replace(/"/g, '\\"')
    const setEnv = envEntries
      .map(([key, value]) => 'set "' + key + '=' + String(value).replace(/"/g, '\\"') + '"')
      .join(' && ')
    const argText = args.map(arg => '"' + arg.replace(/"/g, '\\"') + '"').join(' ')
    const run = '"' + escapedExecutable + '"' + (argText ? ' ' + argText : '')
    return 'cd /d "' + escapedCwd + '"' + (setEnv ? ' && ' + setEnv : '') + ' && ' + run
  }

  const envText = envEntries
    .map(([key, value]) => key + '=' + shellQuote(value))
    .join(' ')
  const argText = args.map(arg => shellQuote(arg)).join(' ')
  const run = (envText ? envText + ' ' : '') + shellQuote(executableCommand) + (argText ? ' ' + argText : '')
  return 'cd ' + shellQuote(cwd) + ' && ' + run
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
  const payloadEnv = payload && payload.env && typeof payload.env === 'object' ? payload.env : {}
  const launchEnv = buildCliLaunchEnv(executableCommand, payloadEnv)

  const shellCommand = buildShellCommand({
    commandName,
    executableCommand,
    cwd,
    env: launchEnv,
    args: payload && payload.args
  })
  if (process.platform === 'darwin') return launchOnMac(shellCommand, terminal)
  if (process.platform === 'win32') {
    return launchOnWindows(shellCommand, terminal, cwd, commandName, executableCommand, Object.assign({}, payload || {}, { env: launchEnv }))
  }
  return launchOnLinux(shellCommand, terminal)
}

module.exports = {
  commandExists,
  resolveCommandPath,
  collectRuntimeSearchDirs,
  buildRuntimePath,
  buildRuntimeEnv,
  getCommandStatus,
  getCommandVersion,
  getCliInstallCommand,
  getAvailableTerminals,
  launchCliCommand,
  _internal: {
    buildShellCommand,
    buildCliLaunchEnv,
    normalizeEnvAssignments
  }
}
