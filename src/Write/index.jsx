import { useEffect } from 'react'

export default function Write ({ enterAction }) {
  useEffect(() => {
    let outputPath
    try {
      if (enterAction.type === 'over') {
        outputPath = window.services.writeTextFile(enterAction.payload)
      } else if (enterAction.type === 'img') {
        outputPath = window.services.writeImageFile(enterAction.payload)
      }
    } catch {
      // 写入错误弹出通知
      window.utools.showNotification('文件保存出错了！')
    }
    if (outputPath) {
      // 在资源管理器中显示
      window.utools.shellShowItemInFolder(outputPath)
    }
    // 退出插件应用
    window.utools.outPlugin()
  }, [enterAction])
}
