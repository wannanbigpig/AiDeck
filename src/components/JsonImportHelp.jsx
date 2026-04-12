export default function JsonImportHelp ({
  requiredText = '',
  example = '',
  title = '必填字段与示例（点击展开）'
}) {
  return (
    <details className='json-import-help'>
      <summary className='json-import-help-summary'>{title}</summary>
      <div className='json-import-help-content'>
        {requiredText
          ? <div className='json-import-help-required'>{requiredText}</div>
          : null}
        <pre className='json-import-help-code'>{example}</pre>
      </div>
    </details>
  )
}
