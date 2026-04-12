function hashSeed (seed) {
  const text = String(seed || '')
  let hash = 0
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0
  }
  return Math.abs(hash)
}

export function getStableCapsuleStyle (seed) {
  const hash = hashSeed(seed)
  const hue = hash % 360
  return {
    color: `hsl(${hue}, 66%, 30%)`,
    background: `hsla(${hue}, 70%, 52%, 0.16)`,
    border: `1px solid hsla(${hue}, 72%, 40%, 0.38)`
  }
}

