import { useEffect, useState } from 'react'
import './index.css'
import { readLocalFile, showOpenDialog } from '../utils/hostBridge.js'

export default function Read ({ enterAction }) {
  const [filePath, setFilePath] = useState('')
  const [fileContent, setFileContent] = useState('')
  const [error, setError] = useState('')

  const loadFile = (nextFilePath) => {
    setError('')
    setFilePath(nextFilePath)
    try {
      const content = readLocalFile(nextFilePath)
      setFileContent(content)
    } catch (err) {
      setError(err.message)
      setFileContent('')
    }
  }

  const handleOpenDialog = async () => {
    const files = await showOpenDialog({
      title: '选择文件',
      properties: ['openFile']
    })
    if (!files) return
    const nextFilePath = files[0]
    if (!nextFilePath) return
    loadFile(nextFilePath)
  }

  useEffect(() => {
    if (enterAction.type === 'files') {
      const nextFilePath = enterAction.payload[0].path
      loadFile(nextFilePath)
    }
  }, [enterAction])

  return (
    <div className='read'>
      <button onClick={handleOpenDialog}>选择文件</button>
      <div className='read-file'>{filePath}</div>
      {fileContent && <pre>{fileContent}</pre>}
      {error && <div className='read-error'>{error}</div>}
    </div>
  )
}
