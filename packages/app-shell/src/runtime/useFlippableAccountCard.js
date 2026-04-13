import { useCallback, useState } from 'react'

export function useFlippableAccountCard () {
  const [flipped, setFlipped] = useState(false)

  const openCard = useCallback(() => {
    setFlipped(true)
  }, [])

  const closeCard = useCallback(() => {
    setFlipped(false)
  }, [])

  const stopFlip = useCallback((event) => {
    event?.stopPropagation?.()
  }, [])

  return {
    flipped,
    openCard,
    closeCard,
    stopFlip
  }
}
