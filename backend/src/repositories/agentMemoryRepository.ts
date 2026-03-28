import { database } from '../database';

export interface AgentMemoryRow {
  id: number;
  user_id: string;
  filename: string;
  content: string;
  updated_at: number;
}

/**
 * List all memory files for a user
 */
export async function listMemories(userId: string): Promise<AgentMemoryRow[]> {
  return database.all<AgentMemoryRow>(
    'SELECT * FROM agent_memories WHERE user_id = ? ORDER BY filename',
    [userId]
  );
}

/**
 * Read a single memory file
 */
export async function getMemory(
  userId: string,
  filename: string
): Promise<AgentMemoryRow | undefined> {
  return database.get<AgentMemoryRow>(
    'SELECT * FROM agent_memories WHERE user_id = ? AND filename = ?',
    [userId, filename]
  );
}

/**
 * Upsert a memory file (insert or update)
 */
export async function upsertMemory(
  userId: string,
  filename: string,
  content: string
): Promise<void> {
  const now = Date.now();
  const existing = await getMemory(userId, filename);
  if (existing) {
    await database.run(
      'UPDATE agent_memories SET content = ?, updated_at = ? WHERE user_id = ? AND filename = ?',
      [content, now, userId, filename]
    );
  } else {
    await database.run(
      'INSERT INTO agent_memories (user_id, filename, content, updated_at) VALUES (?, ?, ?, ?)',
      [userId, filename, content, now]
    );
  }
}
