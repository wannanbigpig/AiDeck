export const AUTO_REFRESH_MINUTES_MIN = 1
export const AUTO_REFRESH_MINUTES_MAX = 60
export const AUTO_REFRESH_MINUTE_MARKS = [1, 15, 30, 45, 60]

export function normalizeRefreshIntervalMinutes (rawValue, fallbackValue = 10) {
  const fallbackNumber = Number(fallbackValue)
  const fallback = Number.isFinite(fallbackNumber) && fallbackNumber <= 0
    ? 0
    : normalizeRefreshIntervalValue(fallbackValue, 10)
  const minutes = Number(rawValue)

  if (!Number.isFinite(minutes)) return fallback
  if (minutes <= 0) return 0
  return normalizeRefreshIntervalValue(minutes, fallback)
}

function normalizeRefreshIntervalValue (value, fallbackValue) {
  const fallback = Number.isFinite(Number(fallbackValue))
    ? Math.round(Number(fallbackValue))
    : 10
  const minutes = Number(value)
  const rounded = Number.isFinite(minutes) ? Math.round(minutes) : fallback
  return Math.max(AUTO_REFRESH_MINUTES_MIN, Math.min(AUTO_REFRESH_MINUTES_MAX, rounded))
}
