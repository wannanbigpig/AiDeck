export const AUTO_REFRESH_MINUTE_OPTIONS = [5, 10, 15, 30, 60]

export function normalizeRefreshIntervalMinutes (rawValue, fallbackValue = 10) {
  const fallback = AUTO_REFRESH_MINUTE_OPTIONS.includes(Number(fallbackValue))
    ? Number(fallbackValue)
    : 10
  const minutes = Number(rawValue)

  if (!Number.isFinite(minutes)) return fallback
  if (minutes <= 0) return 0

  let nearest = AUTO_REFRESH_MINUTE_OPTIONS[0]
  let minDistance = Math.abs(minutes - nearest)

  for (let i = 1; i < AUTO_REFRESH_MINUTE_OPTIONS.length; i++) {
    const candidate = AUTO_REFRESH_MINUTE_OPTIONS[i]
    const distance = Math.abs(minutes - candidate)
    if (distance < minDistance) {
      nearest = candidate
      minDistance = distance
    }
  }

  return nearest
}
