import React, { createContext, useContext, useState, useEffect } from 'react'
import { readHostSetting, writeHostSetting } from '../utils/hostBridge.js'

const PrivacyContext = createContext({
  isPrivacyMode: false,
  togglePrivacyMode: () => {}
})

export const usePrivacy = () => useContext(PrivacyContext)

export const PrivacyProvider = ({ children, namespace = 'global' }) => {
  const storeKey = `aideck_privacy_mode_${namespace}`
  const [isPrivacyMode, setIsPrivacyMode] = useState(() => {
    return readHostSetting(storeKey, false) === true
  })

  const togglePrivacyMode = () => {
    setIsPrivacyMode(prev => {
      const next = !prev
      writeHostSetting(storeKey, next)
      return next
    })
  }

  return (
    <PrivacyContext.Provider value={{ isPrivacyMode, togglePrivacyMode }}>
      {children}
    </PrivacyContext.Provider>
  )
}
