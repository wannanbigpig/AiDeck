import React, { createContext, useContext, useState, useEffect } from 'react'

const PrivacyContext = createContext({
  isPrivacyMode: false,
  togglePrivacyMode: () => {}
})

export const usePrivacy = () => useContext(PrivacyContext)

export const PrivacyProvider = ({ children, namespace = 'global' }) => {
  const storeKey = `aideck_privacy_mode_${namespace}`
  const [isPrivacyMode, setIsPrivacyMode] = useState(() => {
    // 优先从 utools 数据库读取，否则取 localStorage
    try {
      if (window.utools) {
        return !!window.utools.dbStorage.getItem(storeKey)
      }
      return localStorage.getItem(storeKey) === 'true'
    } catch (e) {
      return false
    }
  })

  const togglePrivacyMode = () => {
    setIsPrivacyMode(prev => {
      const next = !prev
      try {
        if (window.utools) {
          window.utools.dbStorage.setItem(storeKey, next)
        }
        localStorage.setItem(storeKey, String(next))
      } catch (e) {}
      return next
    })
  }

  return (
    <PrivacyContext.Provider value={{ isPrivacyMode, togglePrivacyMode }}>
      {children}
    </PrivacyContext.Provider>
  )
}
