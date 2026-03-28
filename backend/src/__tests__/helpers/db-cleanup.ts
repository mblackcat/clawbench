import { database } from '../../database';

/**
 * Delete all rows from every table in FK-safe order (children first).
 *
 * This is the canonical cleanup helper for tests — use it instead of
 * hand-written DELETE statements so that MySQL and PostgreSQL (which
 * enforce foreign keys by default) don't fail.
 */
export async function cleanAllTables(): Promise<void> {
  await database.run('DELETE FROM chat_attachments');
  await database.run('DELETE FROM messages');
  await database.run('DELETE FROM conversations');
  await database.run('DELETE FROM application_versions');
  await database.run('DELETE FROM applications');
  await database.run('DELETE FROM auth_tokens');
  await database.run('DELETE FROM oauth_states');
  await database.run('DELETE FROM users');
}
