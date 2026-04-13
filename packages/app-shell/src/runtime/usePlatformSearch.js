import { useMemo } from 'react'

function normalizeText (value) {
  return String(value || '').trim().toLowerCase()
}

export function usePlatformSearch (items, query, options = {}) {
  const {
    getSearchText = () => '',
    sort = null
  } = options
  const normalizedQuery = normalizeText(query)

  return useMemo(() => {
    const list = Array.isArray(items) ? items.slice() : []
    const filtered = normalizedQuery
      ? list.filter((item) => normalizeText(getSearchText(item)).includes(normalizedQuery))
      : list
    if (typeof sort === 'function') {
      filtered.sort(sort)
    }
    return filtered
  }, [items, normalizedQuery, getSearchText, sort])
}
