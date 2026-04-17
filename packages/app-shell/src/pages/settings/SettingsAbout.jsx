import { useToast } from '../../components/Toast'
import packageJson from '../../../package.json'
import { getPlatformService } from '../../utils/hostBridge.js'
import logoUrl from '../../assets/logo.png'

const PROJECT_GITHUB_URL = 'https://github.com/wannanbigpig/AiDeck'
const PROJECT_GITHUB_ISSUES_URL = 'https://github.com/wannanbigpig/AiDeck/issues'
const PROJECT_AUTHOR_URL = 'https://github.com/wannanbigpig'
const PROJECT_DONATE_URL = 'https://github.com/wannanbigpig/AiDeck/blob/main/docs/DONATE.md'
const PROJECT_VERSION = packageJson.version || '0.1.0'

const AboutUserIcon = () => (
  <svg viewBox='0 0 24 24' width='24' height='24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'>
    <path d='M20 21a8 8 0 0 0-16 0' />
    <circle cx='12' cy='8' r='4' />
  </svg>
)

const AboutGithubIcon = () => (
  <svg viewBox='0 0 24 24' width='24' height='24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'>
    <path d='M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-8 0C5.27.65 4.09 1 4.09 1A5.07 5.07 0 0 0 4 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 8 18.13V22' />
  </svg>
)

const AboutHeartIcon = () => (
  <svg viewBox='0 0 24 24' width='24' height='24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'>
    <path d='m12 21-1.45-1.32C5.4 15.05 2 11.97 2 8.5 2 5.42 4.42 3 7.5 3A5.5 5.5 0 0 1 12 5.09 5.5 5.5 0 0 1 16.5 3C19.58 3 22 5.42 22 8.5c0 3.47-3.4 6.55-8.55 11.18L12 21z' />
  </svg>
)

const AboutFeedbackIcon = () => (
  <svg viewBox='0 0 24 24' width='24' height='24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'>
    <path d='M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z' />
  </svg>
)

export default function SettingsAbout () {
  const toast = useToast()

  const openExternalLink = async (url, errorMessage) => {
    try {
      const svc = getPlatformService('antigravity') || getPlatformService('codex') || getPlatformService('gemini')
      if (svc && typeof svc.openExternalUrl === 'function') {
        const opened = await Promise.resolve(svc.openExternalUrl(url))
        if (opened !== false) return
      }
      if (typeof window !== 'undefined' && typeof window.open === 'function') {
        window.open(url, '_blank', 'noopener,noreferrer')
      }
    } catch (err) {
      toast.error(errorMessage)
    }
  }

  const quickEntries = [
    { key: 'author', title: '主作者', desc: 'wannanbigpig', className: 'is-author', icon: <AboutUserIcon />, onClick: () => openExternalLink(PROJECT_AUTHOR_URL, '打开作者主页失败') },
    { key: 'github', title: '开源仓库', desc: 'github.com/wannanbigpig/AiDeck', className: 'is-github', icon: <AboutGithubIcon />, onClick: () => openExternalLink(PROJECT_GITHUB_URL, '打开 GitHub 失败') },
    { key: 'donate', title: '赞助支持', desc: '支持项目持续开发', className: 'is-donate', icon: <AboutHeartIcon />, onClick: () => openExternalLink(PROJECT_DONATE_URL, '打开赞助页面失败') },
    { key: 'issues', title: '意见反馈', desc: '报告问题或提交建议', className: 'is-feedback', icon: <AboutFeedbackIcon />, onClick: () => openExternalLink(PROJECT_GITHUB_ISSUES_URL, '打开 Issues 页面失败') }
  ]

  return (
    <div className='settings-panel'>
      <h2 className='settings-h2'>关于</h2>
      <div className='settings-card settings-about-card'>
        <div className='settings-about-hero'>
          <img className='settings-about-logo' src={logoUrl} alt='AiDeck logo' />
          <div className='settings-about-title'>AiDeck</div>
          <div className='settings-about-chip-row'>
            <span className='settings-about-chip'>v{PROJECT_VERSION}</span>
            <span className='settings-about-chip'>uTools 插件</span>
          </div>
          <div className='settings-about-desc'>AI IDE 多平台多账号管理工具</div>
          <div className='settings-about-subdesc'>
            AiDeck 是一个面向桌面场景的本地管理工具，用于统一管理 Antigravity、Codex、Gemini CLI 等平台账号，
            提供本地导入、账号切换、配额查看、标签整理与导出等能力。
          </div>
        </div>

        <div className='settings-about-grid'>
          <section className='settings-about-section settings-about-section-compact'>
            <div className='settings-about-entry-grid'>
              {quickEntries.map(item => (
                <button key={item.key} className={`settings-about-entry-card ${item.className}`} onClick={() => { void item.onClick() }}>
                  <div className='settings-about-entry-icon'>{item.icon}</div>
                  <div className='settings-about-entry-title'>{item.title}</div>
                  <div className='settings-about-entry-desc'>{item.desc}</div>
                </button>
              ))}
            </div>
          </section>

          <section className='settings-about-section'>
            <div className='settings-about-section-title'>项目用途说明</div>
            <ul className='settings-about-list'>
              <li>用于 <strong className='settings-about-emphasis'>学习、交流和本地研究</strong> AI IDE 账号管理、配额展示与桌面工具集成方案。</li>
              <li>项目本身 <strong className='settings-about-emphasis'>不是任何第三方平台的官方客户端、官方插件或官方授权管理工具</strong>。</li>
              <li>适合个人在本机环境下对已有账号进行整理、观察和切换，<strong className='settings-about-emphasis'>不应被理解为规避平台策略的承诺工具</strong>。</li>
            </ul>
          </section>

          <section className='settings-about-section'>
            <div className='settings-about-section-title'>使用须知与风险提示</div>
            <ul className='settings-about-list'>
              <li>请仅在你 <strong className='settings-about-emphasis'>合法拥有和有权使用</strong> 的账号、令牌与设备环境中使用本项目，并妥善保管本地凭证文件。</li>
              <li>使用本项目时，仍应自行遵守相关平台的 <strong className='settings-about-emphasis'>服务条款、账号规则、API 使用规范以及所在地法律法规</strong>。</li>
              <li>如因频繁切号、异常请求、凭证泄露、账号风控、服务限流、账号停用或数据误操作导致任何问题，<strong className='settings-about-emphasis'>风险由使用者自行承担</strong>。</li>
              <li>如用于商业运营、批量滥用、绕过限制、违规抓取或其他可能违反条款和法律的场景，<strong className='settings-about-emphasis'>后果与本项目作者无关</strong>。</li>
            </ul>
          </section>

          <section className='settings-about-section settings-about-section-warning'>
            <div className='settings-about-section-title'>免责声明</div>
            <div className='settings-about-disclaimer'>
              本项目按 <strong className='settings-about-emphasis'>“现状”提供</strong>，不附带任何明示或默示担保。
              项目作者与贡献者 <strong className='settings-about-emphasis'>不对因使用、误用、依赖或无法使用本项目而产生的任何直接、间接、附带、特殊或后续损失承担责任</strong>，
              包括但不限于账号异常、凭证泄露、业务中断、数据丢失、收益损失或合规风险。
              你在使用本项目之前，应 <strong className='settings-about-emphasis'>自行评估技术、账号、安全与法律风险，并承担全部使用责任</strong>。
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
