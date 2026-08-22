// Format helpers for the gifting console

export function formatCoins(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString()
}

export function formatRelative(iso: string | Date): string {
  const date = typeof iso === 'string' ? new Date(iso) : iso
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const sec = Math.floor(diffMs / 1000)
  if (sec < 5) return 'just now'
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  if (day < 7) return `${day}d ago`
  return date.toLocaleDateString()
}

export function formatNumber(n: number): string {
  return n.toLocaleString()
}
