import Modal from '../../components/Modal'
import JsonImportHelp from '../../components/JsonImportHelp'
import OAuthBusyNotice from '../../components/OAuthBusyNotice'
import { useOAuthAutoPrepareOnOpen } from '../../runtime/useOAuthAutoPrepareOnOpen.js'
import {
  GlobeIcon,
  KeyIcon,
  DatabaseIcon,
  CopyIcon,
  CheckIcon,
  ArrowPathIcon
} from '../../components/Icons/ActionIcons'

export default function GeminiAddAccountModal ({
  open,
  onClose,
  addTab,
  onSwitchTab,
  oauthAuthUrl,
  oauthPreparing,
  oauthPrepareError,
  oauthUrlCopied,
  onCopyOAuthUrl,
  onOpenOAuthInBrowser,
  onCancelOAuthInBrowser,
  onPrepareOAuthSession,
  oauthCallbackInput,
  onOAuthCallbackInputChange,
  oauthRedirectUri,
  oauthBusy,
  oauthSessionId,
  oauthRecovered,
  oauthPolling,
  onSubmitOAuthCallback,
  idTokenInput,
  onIdTokenInputChange,
  accessTokenInput,
  onAccessTokenInputChange,
  refreshTokenInput,
  onRefreshTokenInputChange,
  onAddWithToken,
  importJson,
  onImportJsonChange,
  jsonImportRequiredText,
  jsonImportExample,
  onImportJson,
  importingLocal,
  onImportLocal,
  toast
}) {
  useOAuthAutoPrepareOnOpen({
    open,
    addTab,
    oauthPreparing,
    oauthAuthUrl,
    oauthSessionId,
    onPrepareOAuthSession
  })

  return (
    <Modal title='添加 Antigravity 账号' open={open} onClose={onClose}>
      <div className='oauth-tab-switch'>
        <button className={`oauth-tab-btn ${addTab === 'oauth' ? 'active' : ''}`} onClick={() => onSwitchTab('oauth')}>
          {oauthPolling ? <ArrowPathIcon size={14} style={{ marginRight: 6 }} spinning /> : <GlobeIcon size={14} style={{ marginRight: 6 }} />}
          {oauthPolling ? '授权中...' : 'OAuth 授权'}
        </button>
        <button className={`oauth-tab-btn ${addTab === 'token' ? 'active' : ''}`} onClick={() => onSwitchTab('token')}>
          <KeyIcon size={14} style={{ marginRight: 6 }} /> Token / JSON
        </button>
        <button className={`oauth-tab-btn ${addTab === 'local' ? 'active' : ''}`} onClick={() => onSwitchTab('local')}>
          <DatabaseIcon size={14} style={{ marginRight: 6 }} /> 本地导入
        </button>
      </div>

      {addTab === 'oauth' && (
        <>
          <div className='form-group'>
            <label className='form-label'>授权链接</label>
            <div className='oauth-row'>
              <input
                className='form-input'
                readOnly
                value={oauthAuthUrl}
                placeholder={oauthPreparing ? '正在生成授权链接...' : '弹窗打开后会自动生成 OAuth 授权地址'}
              />
              <button className='btn btn-icon' onClick={onCopyOAuthUrl} disabled={oauthBusy || !oauthAuthUrl}>
                {oauthUrlCopied ? <CheckIcon size={14} stroke='#10b981' /> : <CopyIcon size={14} />}
              </button>
            </div>
          </div>

          {oauthPrepareError && <div className='oauth-error'>{oauthPrepareError}</div>}
          <OAuthBusyNotice busy={oauthBusy} />

          <div className='oauth-action-row'>
            {oauthPolling ? (
              oauthBusy ? (
                // 正在处理回调，显示"回调处理中..."
                <button className='btn btn-primary' disabled>
                  <ArrowPathIcon size={14} style={{ marginRight: 6 }} spinning />
                  回调处理中...
                </button>
              ) : (
                // 等待回调，显示"取消授权"
                <button className='btn btn-danger' onClick={onCancelOAuthInBrowser}>
                  <ArrowPathIcon size={14} style={{ marginRight: 6 }} />
                  取消授权
                </button>
              )
            ) : (
              <button className='btn btn-primary' disabled={oauthBusy || oauthPreparing || !oauthAuthUrl} onClick={onOpenOAuthInBrowser}>
                <GlobeIcon size={14} style={{ marginRight: 6 }} />
                开始授权
              </button>
            )}
            <button className='btn' disabled={oauthBusy || oauthPreparing || oauthPolling} onClick={() => {
              void onPrepareOAuthSession()
              toast?.info?.('已生成新的授权链接，旧的链接已失效。请使用最新的链接进行授权。')
            }}>
              <ArrowPathIcon size={14} style={{ marginRight: 6 }} spinning={oauthPreparing} />
              {oauthPreparing ? '生成链接中...' : '重新生成授权链接'}
            </button>
          </div>

          <div className='form-group' style={{ marginTop: 12 }}>
            <label className='form-label'>手动输入回调地址</label>
            <div className='oauth-row oauth-row-callback'>
              <input
                className='form-input'
                value={oauthCallbackInput}
                onChange={(e) => onOAuthCallbackInputChange(e.target.value)}
                disabled={oauthBusy}
                placeholder={oauthRedirectUri ? `粘贴完整回调地址，例如：${oauthRedirectUri}?code=...&state=...` : '粘贴完整回调地址，例如：http://127.0.0.1:1458/oauth2callback?...'}
              />
              <button
                className='btn btn-primary'
                disabled={oauthBusy || !oauthSessionId || !oauthCallbackInput.trim()}
                onClick={() => void onSubmitOAuthCallback()}
              >
                {oauthBusy ? '提交中...' : '提交回调'}
              </button>
            </div>
          </div>

          <div className='oauth-hint'>
            {oauthRecovered ? '已恢复上次未完成的 OAuth 会话，可直接继续提交回调。' : ''}
            {oauthRecovered ? <br /> : null}
            {oauthPolling ? '正在等待浏览器自动回调...' : ''}
            {oauthPolling ? <br /> : null}
            完成浏览器授权后，将完整回调地址粘贴到这里即可继续。
            <br />
            若悬浮窗口会失焦收起，建议先按 Ctrl+D 分离窗口，或在插件菜单中勾选“自动分离为独立窗口”。
          </div>
        </>
      )}

      {addTab === 'token' && (
        <>
          <div className='form-group'>
            <label className='form-label'>手动添加 Token</label>
            <input className='form-input' placeholder='id_token（可选）' value={idTokenInput} onChange={(e) => onIdTokenInputChange(e.target.value)} />
            <input className='form-input' style={{ marginTop: 8 }} placeholder='access_token（至少填写 id_token/access_token 之一）' value={accessTokenInput} onChange={(e) => onAccessTokenInputChange(e.target.value)} />
            <input className='form-input' style={{ marginTop: 8 }} placeholder='refresh_token（可选）' value={refreshTokenInput} onChange={(e) => onRefreshTokenInputChange(e.target.value)} />
            <div className='oauth-action-row' style={{ marginTop: 10 }}>
              <button className='btn btn-primary' onClick={onAddWithToken}>添加 Token 账号</button>
            </div>
          </div>

          <div className='oauth-divider'>或粘贴 JSON 导入</div>

          <div className='form-group' style={{ marginBottom: 0 }}>
            <label className='form-label'>账号 JSON 数据</label>
            <textarea
              className='form-textarea'
              placeholder='[{\"email\":\"...\",\"access_token\":\"...\",\"refresh_token\":\"...\"}]'
              value={importJson}
              onChange={(e) => onImportJsonChange(e.target.value)}
            />
            <JsonImportHelp requiredText={jsonImportRequiredText} example={jsonImportExample} />
            <div className='oauth-action-row' style={{ marginTop: 10 }}>
              <button className='btn btn-primary' onClick={onImportJson}>导入 JSON</button>
            </div>
          </div>
        </>
      )}

      {addTab === 'local' && (
        <div className='form-group' style={{ marginBottom: 0 }}>
          <label className='form-label'>从本机导入</label>
          <div className='oauth-hint' style={{ marginBottom: 10 }}>
            支持从当前系统默认 Antigravity 配置目录中自动探测并导入当前登录账号。
          </div>
          <div className='oauth-action-row'>
            <button className='btn btn-primary' onClick={onImportLocal} disabled={importingLocal}>
              {importingLocal ? '导入中...' : <><DatabaseIcon size={14} style={{ marginRight: 6 }} /> 从本机 Antigravity 导入</>}
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}
