import { useState } from 'react'
import SettingsAppearance from './settings/SettingsAppearance'
import SettingsGeneral from './settings/SettingsGeneral'
import SettingsPersonalize from './settings/SettingsPersonalize'
import SettingsAbout from './settings/SettingsAbout'
import { 
  SettingsIcon, 
  SunIcon, 
  SparklesIcon, 
  InfoIcon,
  ArrowLeftIcon
} from '../components/Icons/ActionIcons'

const SETTINGS_TABS = [
  {
    id: 'general',
    label: '常规',
    icon: <SettingsIcon size={16} />
  },
  {
    id: 'appearance',
    label: '外观',
    icon: <SunIcon size={16} />
  },
  {
    id: 'personalize',
    label: '个性化',
    icon: <SparklesIcon size={16} />
  },
  {
    id: 'about',
    label: '关于',
    icon: <InfoIcon size={16} />
  }
]

const SETTINGS_TAB_COMPONENTS = {
  general: SettingsGeneral,
  appearance: SettingsAppearance,
  personalize: SettingsPersonalize,
  about: SettingsAbout
}

export default function SettingsPageImpl ({ onNavigate, returnPlatform = 'dashboard', globalSettings, onGlobalSettingsChange }) {
  const [activeTab, setActiveTab] = useState('general')
  const ActiveSection = SETTINGS_TAB_COMPONENTS[activeTab] || SettingsAppearance
  const backTarget = returnPlatform && returnPlatform !== 'settings' ? returnPlatform : 'dashboard'

  return (
    <div className='settings-layout'>
      <div className='settings-sidebar'>
        <div className='settings-back' onClick={() => onNavigate(backTarget)}>
          <ArrowLeftIcon size={16} style={{ strokeWidth: 2.5 }} />
          返回应用
        </div>
        <nav className='settings-nav'>
          {SETTINGS_TABS.map(tab => (
            <div
              key={tab.id}
              className={`settings-nav-item ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </div>
          ))}
        </nav>
      </div>
      <div className='settings-content'>
        <ActiveSection
          globalSettings={globalSettings}
          onGlobalSettingsChange={onGlobalSettingsChange}
        />
      </div>
    </div>
  )
}
