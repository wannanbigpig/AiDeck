import Modal from '../../components/Modal'

export default function AntigravityDeviceIdentityModal ({
  detailAccount,
  detailDeviceMeta,
  detailDeviceFields,
  onClose
}) {
  return (
    <Modal title='绑定设备身份' open={!!detailAccount} onClose={onClose}>
      {detailAccount && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[
            ['账号', detailAccount.email || detailAccount.id || '-', false],
            ['来源', detailDeviceMeta.sourceLabel, false],
            ['状态', detailDeviceMeta.profile ? '已绑定' : '未绑定', false]
          ].map(([label, value, mono]) => (
            <div
              key={label}
              style={{
                display: 'grid',
                gridTemplateColumns: '180px minmax(0, 1fr)',
                alignItems: 'start',
                gap: 18
              }}
            >
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 600, lineHeight: 1.6, wordBreak: 'break-word' }}>
                {label}
              </div>
              <div
                style={{
                  fontSize: label === '账号' ? 14 : 13,
                  color: 'var(--text-primary)',
                  fontWeight: label === '账号' ? 600 : 500,
                  fontFamily: mono ? 'SFMono-Regular, Consolas, monospace' : 'inherit',
                  lineHeight: 1.6,
                  wordBreak: 'break-all'
                }}
              >
                {String(value || '-')}
              </div>
            </div>
          ))}

          {detailDeviceMeta.profile
            ? detailDeviceFields.map(([label, value]) => (
              <div
                key={label}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '180px minmax(0, 1fr)',
                  alignItems: 'start',
                  gap: 18
                }}
              >
                <div style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 600, lineHeight: 1.6, wordBreak: 'break-word' }}>
                  {label}
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: 'var(--text-primary)',
                    fontFamily: 'SFMono-Regular, Consolas, monospace',
                    lineHeight: 1.6,
                    wordBreak: 'break-all'
                  }}
                >
                  {String(value || '-')}
                </div>
              </div>
            ))
            : (
              <div
                style={{
                  marginTop: 2,
                  fontSize: 12,
                  color: 'var(--text-muted)',
                  lineHeight: 1.7
                }}
              >
                当前账号尚未绑定设备身份。开启“切号时更换设备身份”后执行一次切号，或重新导入账号，即可为该账号建立绑定。
              </div>
              )}
        </div>
      )}
    </Modal>
  )
}
