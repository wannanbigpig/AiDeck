import { useEffect, useState, createContext, useContext, useCallback } from 'react'
import { readHostSetting, writeHostSetting } from '../utils/hostBridge.js'

const ThemeContext = createContext(null)

/**
 * 获取当前主题 Hook
 * @returns {{ theme: string, setTheme: (t: string) => void, resolvedTheme: string }}
 */
export function useTheme () {
  return useContext(ThemeContext)
}

/**
 * 主题 Provider
 * 支持 dark / light / auto 三种模式
 * 偏好存储在宿主级 settings store
 */
export function ThemeProvider ({ children }) {
  const [theme, setThemeState] = useState(() => {
    return readHostSetting('aideck:theme', 'auto') || 'auto'
  })

  const [resolvedTheme, setResolvedTheme] = useState('dark')

  // 应用主题到 DOM
  const applyTheme = useCallback((t) => {
    document.documentElement.setAttribute('data-theme', t)

    // 计算实际生效的主题
    if (t === 'auto') {
      const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches
      setResolvedTheme(isDark ? 'dark' : 'light')
    } else {
      setResolvedTheme(t)
    }
  }, [])

  // 设置主题并持久化
  const setTheme = useCallback((t) => {
    setThemeState(t)
    writeHostSetting('aideck:theme', t)
    applyTheme(t)
  }, [applyTheme])

  // 初始化
  useEffect(() => {
    applyTheme(theme)
  }, [])

  // 监听系统主题变化（auto 模式下实时响应）
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => {
      if (theme === 'auto') {
        setResolvedTheme(mq.matches ? 'dark' : 'light')
      }
    }
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [theme])

  return (
    <ThemeContext.Provider value={{ theme, setTheme, resolvedTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}
