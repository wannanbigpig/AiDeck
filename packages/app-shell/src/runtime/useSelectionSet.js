import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

function toIdSet (value) {
  if (value instanceof Set) return new Set(Array.from(value).map((item) => String(item || '').trim()).filter(Boolean))
  if (!Array.isArray(value)) return new Set()
  return new Set(value.map((item) => String(item || '').trim()).filter(Boolean))
}

export function useSelectionSet (items, options = {}) {
  const {
    getId = (item) => item && item.id,
    initialValue = []
  } = options
  const [selectedIds, setSelectedIds] = useState(() => toIdSet(initialValue))

  const getIdRef = useRef(getId)
  useEffect(() => {
    getIdRef.current = getId
  }, [getId])

  const validIds = useMemo(() => {
    const next = new Set()
    const list = Array.isArray(items) ? items : []
    const identifier = getIdRef.current
    for (let i = 0; i < list.length; i++) {
      const id = String(identifier(list[i]) || '').trim()
      if (id) next.add(id)
    }
    return next
  }, [items])

  useEffect(() => {
    setSelectedIds((prev) => {
      let changed = false
      const next = new Set()
      prev.forEach((id) => {
        if (validIds.has(id)) {
          next.add(id)
        } else {
          changed = true
        }
      })
      if (!changed && prev.size === next.size) return prev
      return next
    })
  }, [validIds])

  const toggleSelection = useCallback((accountId) => {
    const id = String(accountId || '').trim()
    if (!id) return
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set())
  }, [])

  const replaceSelection = useCallback((nextValue) => {
    setSelectedIds(toIdSet(nextValue))
  }, [])

  return {
    selectedIds,
    selectedCount: selectedIds.size,
    setSelectedIds,
    toggleSelection,
    clearSelection,
    replaceSelection
  }
}
