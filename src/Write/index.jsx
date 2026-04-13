import { useEffect } from 'react'
import { exitPlugin, showItemInFolder, showNotification, writeImageFile, writeTextFile } from '../utils/hostBridge.js'

export default function Write ({ enterAction }) {
  useEffect(() => {
    let disposed = false

    async function run () {
      let outputPath = ''
      try {
        if (enterAction.type === 'over') {
          outputPath = await writeTextFile(enterAction.payload)
        } else if (enterAction.type === 'img') {
          outputPath = await writeImageFile(enterAction.payload)
        }
      } catch (err) {
        await showNotification('文件保存出错了！')
      }

      if (disposed) return
      if (outputPath) {
        await showItemInFolder(outputPath)
      }
      await exitPlugin()
    }

    void run()

    return () => {
      disposed = true
    }
  }, [enterAction])
}
