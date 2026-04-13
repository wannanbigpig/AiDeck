import { useCallback, useState } from 'react'

function buildTimestamp () {
  const now = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
}

export function usePlatformExportDialog ({ copyText, toast, filenamePrefix }) {
  const [exportDialog, setExportDialog] = useState({ open: false, json: '', count: 0 })

  const openExportDialog = useCallback((json, count) => {
    setExportDialog({
      open: true,
      json: String(json || ''),
      count: Number(count || 0)
    })
  }, [])

  const closeExportDialog = useCallback(() => {
    setExportDialog((prev) => Object.assign({}, prev, { open: false }))
  }, [])

  const copyExportJson = useCallback(async () => {
    const content = String(exportDialog.json || '')
    if (!content) {
      toast?.warning?.('暂无可导出的 JSON 内容')
      return false
    }
    const ok = await copyText(content)
    if (ok) {
      toast?.success?.('已复制到剪贴板')
      return true
    }
    toast?.warning?.('复制失败，请手动复制')
    return false
  }, [copyText, exportDialog.json, toast])

  const downloadExportJson = useCallback(() => {
    const content = String(exportDialog.json || '')
    if (!content) {
      toast?.warning?.('暂无可导出的 JSON 内容')
      return false
    }
    try {
      const blob = new Blob([content], { type: 'application/json;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${filenamePrefix}-${buildTimestamp()}.json`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
      toast?.success?.('已开始下载 JSON 文件')
      return true
    } catch (error) {
      toast?.warning?.('下载失败，请先复制再手动保存')
      return false
    }
  }, [exportDialog.json, filenamePrefix, toast])

  return {
    exportDialog,
    openExportDialog,
    closeExportDialog,
    copyExportJson,
    downloadExportJson
  }
}
