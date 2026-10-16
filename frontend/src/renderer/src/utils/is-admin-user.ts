/**
 * Global-admin check that tolerates user objects without a `role` field
 * (older auth payloads / local mode). Admins can overwrite-publish builtin
 * apps and see them in 「我的」.
 */
export function isAdminUser(user: unknown): boolean {
  return !!user && typeof user === 'object' && (user as { role?: unknown }).role === 'admin'
}
