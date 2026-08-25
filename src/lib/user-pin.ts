const STORAGE_KEY = 'inwe-user-name'

export function getUserName(): string | null {
  try { return localStorage.getItem(STORAGE_KEY) } catch { return null }
}
export function setUserName(name: string): void {
  try { localStorage.setItem(STORAGE_KEY, name) } catch {}
}
export function clearUserName(): void {
  try { localStorage.removeItem(STORAGE_KEY) } catch {}
}
export function isLoggedIn(): boolean {
  return getUserName() !== null
}
export function getAuthHeader(): Record<string, string> {
  const name = getUserName()
  return name ? { 'x-user-name': name } : {}
}
