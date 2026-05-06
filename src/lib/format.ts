export function formatDistanceMeters(meters: number): string {
  if (!Number.isFinite(meters)) return '-'
  if (meters < 1000) return `${Math.round(meters)} m`
  return `${(meters / 1000).toFixed(meters >= 10000 ? 0 : 1)} km`
}

export function formatDurationSeconds(seconds: number): string {
  if (!Number.isFinite(seconds)) return '-'
  const mins = Math.round(seconds / 60)
  if (mins < 60) return `${mins} min`
  const hrs = Math.floor(mins / 60)
  const rem = mins % 60
  return rem === 0 ? `${hrs} h` : `${hrs} h ${rem} min`
}
