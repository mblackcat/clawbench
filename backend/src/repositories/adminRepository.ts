import { database } from '../database';
import { User, UserRow, userRowToUser } from '../models/user';

/**
 * Admin data access layer.
 * All methods require an admin-level caller — authorization is enforced by middleware.
 */

/**
 * List users with optional search, pagination.
 * Search matches against username and email (LIKE).
 */
export async function listUsers(
  search?: string,
  limit: number = 20,
  offset: number = 0
): Promise<User[]> {
  if (search && search.trim()) {
    const term = `%${search.trim()}%`;
    const rows = await database.all<UserRow>(
      `SELECT * FROM users
       WHERE username LIKE ? OR email LIKE ?
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      [term, term, limit, offset]
    );
    return rows.map(userRowToUser);
  }

  const rows = await database.all<UserRow>(
    `SELECT * FROM users ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [limit, offset]
  );
  return rows.map(userRowToUser);
}

/**
 * Count users with optional search filter.
 */
export async function countUsers(search?: string): Promise<number> {
  if (search && search.trim()) {
    const term = `%${search.trim()}%`;
    const row = await database.get<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM users WHERE username LIKE ? OR email LIKE ?`,
      [term, term]
    );
    return row?.cnt ?? 0;
  }

  const row = await database.get<{ cnt: number }>(
    `SELECT COUNT(*) AS cnt FROM users`
  );
  return row?.cnt ?? 0;
}

/**
 * Update a user's role.
 */
export async function updateUserRole(
  userId: string,
  role: 'admin' | 'user'
): Promise<User | undefined> {
  const now = Date.now();
  await database.run(
    `UPDATE users SET role = ?, updated_at = ? WHERE user_id = ?`,
    [role, now, userId]
  );

  const row = await database.get<UserRow>(
    `SELECT * FROM users WHERE user_id = ?`,
    [userId]
  );
  return row ? userRowToUser(row) : undefined;
}

/**
 * Delete a user by ID.
 * Returns true if a row was deleted.
 */
export async function deleteUser(userId: string): Promise<boolean> {
  const result = await database.run(
    `DELETE FROM users WHERE user_id = ?`,
    [userId]
  );
  return result.changes > 0;
}

/**
 * Get dashboard aggregate stats.
 */
export interface DashboardStats {
  totalUsers: number;
  totalApplications: number;
  totalDownloads: number;
  publishedApplications: number;
  applicationByType: Record<string, number>;
}

export async function getDashboardStats(): Promise<DashboardStats> {
  const [userRow, appRow, downloadRow, publishedRow, typeRows] = await Promise.all([
    database.get<{ cnt: number }>(`SELECT COUNT(*) AS cnt FROM users`),
    database.get<{ cnt: number }>(`SELECT COUNT(*) AS cnt FROM applications`),
    database.get<{ cnt: number }>(
      `SELECT COALESCE(SUM(download_count), 0) AS cnt FROM applications`
    ),
    database.get<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM applications WHERE published = 1`
    ),
    database.all<{ type: string; cnt: number }>(
      `SELECT type, COUNT(*) AS cnt FROM applications GROUP BY type`
    ),
  ]);

  const applicationByType: Record<string, number> = {};
  for (const row of typeRows) {
    applicationByType[row.type || 'app'] = row.cnt;
  }

  return {
    totalUsers: userRow?.cnt ?? 0,
    totalApplications: appRow?.cnt ?? 0,
    totalDownloads: downloadRow?.cnt ?? 0,
    publishedApplications: publishedRow?.cnt ?? 0,
    applicationByType,
  };
}

/**
 * List all applications (including unpublished) for admin review.
 */
import { Application, ApplicationRow, applicationRowToApplication } from '../models/application';

export async function listAllApplications(
  search?: string,
  type?: string,
  limit: number = 20,
  offset: number = 0
): Promise<Application[]> {
  let query = `SELECT * FROM applications WHERE 1=1`;
  const params: (string | number)[] = [];

  if (search && search.trim()) {
    query += ` AND (name LIKE ? OR description LIKE ?)`;
    const term = `%${search.trim()}%`;
    params.push(term, term);
  }

  if (type && type !== 'all') {
    query += ` AND type = ?`;
    params.push(type);
  }

  query += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const rows = await database.all<ApplicationRow>(query, params);
  return rows.map(applicationRowToApplication);
}

export async function countAllApplications(
  search?: string,
  type?: string
): Promise<number> {
  let query = `SELECT COUNT(*) AS cnt FROM applications WHERE 1=1`;
  const params: string[] = [];

  if (search && search.trim()) {
    query += ` AND (name LIKE ? OR description LIKE ?)`;
    const term = `%${search.trim()}%`;
    params.push(term, term);
  }

  if (type && type !== 'all') {
    query += ` AND type = ?`;
    params.push(type);
  }

  const row = await database.get<{ cnt: number }>(query, params);
  return row?.cnt ?? 0;
}
