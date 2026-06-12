/**
 * First-party app detection — shared between OAuth store and legacy auth DB.
 */
export function isFirstPartyAppName(name: string): boolean {
  return name.trim().toLowerCase() === 'aincore notes'
}
