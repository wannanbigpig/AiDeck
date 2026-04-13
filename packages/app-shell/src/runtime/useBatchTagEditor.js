import { useCallback, useState } from 'react'

export function useBatchTagEditor (initialValue = '') {
  const [state, setState] = useState(() => ({
    open: false,
    value: String(initialValue || '')
  }))

  const openEditor = useCallback((value = '') => {
    setState({
      open: true,
      value: String(value || '')
    })
  }, [])

  const closeEditor = useCallback(() => {
    setState({
      open: false,
      value: ''
    })
  }, [])

  const setValue = useCallback((value) => {
    setState((prev) => Object.assign({}, prev, {
      value: String(value || '')
    }))
  }, [])

  return {
    batchTagEditor: state,
    openBatchTagEditor: openEditor,
    closeBatchTagEditor: closeEditor,
    setBatchTagValue: setValue
  }
}
