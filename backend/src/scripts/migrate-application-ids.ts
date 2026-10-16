/**
 * 线上数据修复脚本：将 applications 表的 application_id 迁移为对应 manifest.id
 *
 * 背景：
 * 旧版后端在创建应用时使用 uuidv4() 生成 application_id，应用市场发布时未以 manifest.id
 * 作为唯一标识，导致用户修改应用名称或描述后，重新发布会生成新的应用记录。
 * 本脚本扫描数据库中所有应用：
 *   1. 从应用上传的 zip 包（application_versions 表）中读取 manifest.json 的 id 字段；
 *   2. 若无上传包或未定义（或不合法）id，则基于所有者用户名与应用名称自动生成 cb.{username}.{slug}；
 *   3. 检查重名冲突，若有重复自动追加 -2, -3 等数字后缀；
 *   4. 以外键安全的 Insert-Repoint-Delete 策略（每个应用一个事务）更新 applications、
 *      application_versions、application_execution_errors 表，提交后重命名磁盘上的存储目录；
 *   5. 默认以 --dry-run 模式运行进行安全预览，添加 --apply 或 --force 参数时才真正执行写入。
 *
 * 使用方法：
 *   预览迁移（只读预览，不修改任何数据）：
 *     npm run migrate-app-ids
 *     或
 *     ts-node-dev --transpile-only src/scripts/migrate-application-ids.ts
 *
 *   正式执行迁移：
 *     npm run migrate-app-ids -- --apply
 *     或
 *     ts-node-dev --transpile-only src/scripts/migrate-application-ids.ts --apply
 */

import fs from 'fs';
import path from 'path';
import { database } from '../database';
import { initializeSchema } from '../database/schema';
import { logger } from '../utils/logger';
import { config } from '../config';
import { readZipEntry } from '../utils/zip';

/** 迁移生成的应用 ID 前缀（无 manifest.id 时使用） */
export const DERIVED_APP_ID_PREFIX = 'cb.';

/** 与 POST /api/v1/applications 一致的应用 ID 规则（ID 也是存储目录名） */
const APP_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

function isValidAppId(id: string): boolean {
  return id.length > 0 && id.length <= 255 && APP_ID_PATTERN.test(id);
}

interface ApplicationRow {
  application_id: string;
  name: string;
  description: string | null;
  owner_id: string;
  type: string | null;
  category: string | null;
  published: number;
  featured: number;
  download_count: number;
  execution_count: number;
  metadata: string | null;
  created_at: number;
  updated_at: number;
}

interface VersionRow {
  version_id: string;
  application_id: string;
  version: string;
  changelog: string | null;
  file_path: string;
  file_size: number;
  published_at: number;
}

interface UserRow {
  user_id: string;
  username: string;
}

interface MigrationPlan {
  oldId: string;
  newId: string;
  name: string;
  ownerUsername: string;
  source: 'manifest-zip' | 'metadata' | 'derived';
  versions: VersionRow[];
  oldStorageDir?: string;
  newStorageDir?: string;
}

/** 合法 SQL 列名（来自 SELECT * 的行键；防御性校验后才拼进语句） */
const SAFE_COLUMN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * 基于源行的全部列构造 INSERT（application_id 替换为 newId）。
 * 动态列表保证 schema 新增的列（如 A30 补齐列）不会在迁移中丢失。
 */
export function buildApplicationCopyInsert(
  row: Record<string, unknown>,
  newId: string
): { sql: string; params: unknown[] } {
  const columns = Object.keys(row);
  if (!columns.includes('application_id')) {
    throw new Error('applications row has no application_id column');
  }
  for (const col of columns) {
    if (!SAFE_COLUMN.test(col)) throw new Error(`Unexpected column name: ${col}`);
  }
  const params = columns.map((col) => (col === 'application_id' ? newId : row[col]));
  const placeholders = columns.map(() => '?').join(', ');
  return {
    sql: `INSERT INTO applications (${columns.join(', ')}) VALUES (${placeholders})`,
    params,
  };
}

/** 辅助：从应用名称中提取短 slug（用于无 manifest 时的备用生成） */
function fallbackSlug(name: string): string {
  const raw = (name || '').trim();
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  if (slug) return slug;
  if (raw) {
    let h = 0;
    for (let i = 0; i < raw.length; i++) {
      h = (Math.imul(h, 31) + raw.charCodeAt(i)) >>> 0;
    }
    return `app-${h.toString(36).slice(0, 6)}`;
  }
  return 'app';
}

/** 辅助：冲突自动追加后缀数字 */
function resolveUnique(baseId: string, used: Set<string>): string {
  if (!used.has(baseId)) return baseId;
  let idx = 2;
  while (used.has(`${baseId}-${idx}`)) {
    idx++;
  }
  return `${baseId}-${idx}`;
}

/** 主迁移流程 */
export async function runMigration(options?: { apply?: boolean }): Promise<{
  total: number;
  unchanged: number;
  migrated: number;
  plans: MigrationPlan[];
}> {
  const isApply = !!options?.apply;
  logger.info(`Starting application ID migration (mode: ${isApply ? 'APPLY' : 'DRY-RUN'})...`);

  // 1. 连接数据库并确保存储目录和数据库表结构最新
  try {
    await database.connect();
  } catch {
    // already connected
  }
  await initializeSchema();

  const storagePath = config.storage.path || path.join(__dirname, '../../uploads');

  // 2. 查询所有用户映射
  const userRows = await database.all<UserRow>('SELECT user_id, username FROM users');
  const userMap = new Map<string, string>();
  for (const u of userRows) {
    userMap.set(u.user_id, u.username);
  }

  // 3. 查询所有应用
  const apps = await database.all<ApplicationRow>(
    'SELECT * FROM applications ORDER BY created_at ASC'
  );

  // 4. 查询所有应用版本
  const versions = await database.all<VersionRow>(
    'SELECT * FROM application_versions ORDER BY published_at DESC'
  );
  const versionMap = new Map<string, VersionRow[]>();
  for (const v of versions) {
    const list = versionMap.get(v.application_id) || [];
    list.push(v);
    versionMap.set(v.application_id, list);
  }

  // 已占用的 ID 集合（包含现有已是 manifest.id 格式的 id）
  const assignedIds = new Set<string>();
  for (const app of apps) {
    // 如果不是标准的 36 位 uuid（如 cb.xxx 或 com.xxx），说明可能是已经规范的 ID
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      app.application_id
    );
    if (!isUuid) {
      assignedIds.add(app.application_id);
    }
  }

  const plans: MigrationPlan[] = [];
  let unchangedCount = 0;

  for (const app of apps) {
    const appVersions = versionMap.get(app.application_id) || [];
    const ownerName = userMap.get(app.owner_id) || 'user';

    let manifestId: string | undefined;
    let source: MigrationPlan['source'] = 'derived';

    // 尝试从最新版本的 zip 包中读取 manifest.json
    for (const v of appVersions) {
      const fullPath = path.isAbsolute(v.file_path)
        ? v.file_path
        : path.join(storagePath, v.file_path);

      if (fs.existsSync(fullPath)) {
        try {
          const content = readZipEntry(fullPath, 'manifest.json');
          if (content) {
            const parsed = JSON.parse(content);
            if (parsed && typeof parsed.id === 'string' && isValidAppId(parsed.id.trim())) {
              manifestId = parsed.id.trim();
              source = 'manifest-zip';
              break;
            }
          }
        } catch {
          // 读取或解析失败，尝试下一版本
        }
      }
    }

    // 尝试从应用元数据中获取
    if (!manifestId && app.metadata) {
      try {
        const meta = JSON.parse(app.metadata);
        if (meta && typeof meta.manifestId === 'string' && isValidAppId(meta.manifestId.trim())) {
          manifestId = meta.manifestId.trim();
          source = 'metadata';
        }
      } catch {
        // ignore
      }
    }

    // 回退：从 username + slug 派生
    if (!manifestId) {
      const slug = fallbackSlug(app.name);
      manifestId = `${DERIVED_APP_ID_PREFIX}${ownerName.toLowerCase().replace(/[^a-z0-9]/g, '') || 'user'}.${slug}`;
      source = 'derived';
    }

    // 如果应用当前的 application_id 已经与目标 manifestId 一致，跳过
    if (app.application_id === manifestId) {
      unchangedCount++;
      assignedIds.add(manifestId);
      continue;
    }

    // 解决目标 ID 的重名冲突
    const uniqueTargetId = resolveUnique(manifestId, assignedIds);
    assignedIds.add(uniqueTargetId);

    const oldStorageDir = path.join(storagePath, app.application_id);
    const newStorageDir = path.join(storagePath, uniqueTargetId);

    plans.push({
      oldId: app.application_id,
      newId: uniqueTargetId,
      name: app.name,
      ownerUsername: ownerName,
      source,
      versions: appVersions,
      oldStorageDir,
      newStorageDir,
    });
  }

  // 打印计划摘要
  console.log('===============================================================');
  console.log(`[Migrate App IDs] Inspection finished:`);
  console.log(`  Total applications:     ${apps.length}`);
  console.log(`  Already compliant:      ${unchangedCount}`);
  console.log(`  Requires migration:     ${plans.length}`);
  console.log('===============================================================');

  for (const plan of plans) {
    console.log(`- App: "${plan.name}" (owner: ${plan.ownerUsername})`);
    console.log(`  Old ID:     ${plan.oldId}`);
    console.log(`  New ID:     ${plan.newId} (source: ${plan.source})`);
    console.log(`  Versions:   ${plan.versions.length} record(s)`);
    if (plan.oldStorageDir && fs.existsSync(plan.oldStorageDir)) {
      console.log(`  Storage:    ${plan.oldStorageDir} -> ${plan.newStorageDir}`);
    }
  }

  if (!isApply) {
    console.log('\n[DRY-RUN] No changes were written to the database or file system.');
    console.log('[DRY-RUN] Run with --apply to execute the migration:');
    console.log('  npm run migrate-app-ids -- --apply\n');
    return {
      total: apps.length,
      unchanged: unchangedCount,
      migrated: 0,
      plans,
    };
  }

  // 执行真正的迁移
  console.log('\nApplying migrations to database and storage directory...');
  let migratedCount = 0;

  for (const plan of plans) {
    try {
      // 1. 查找源记录
      const oldApp = await database.get<ApplicationRow>(
        'SELECT * FROM applications WHERE application_id = ?',
        [plan.oldId]
      );
      if (!oldApp) {
        console.warn(`[WARN] Application ${plan.oldId} no longer exists, skipping.`);
        continue;
      }

      await database.transaction(async () => {
        // 2. 插入新 ID 的 application 记录：按源行的全部列动态复制（含以后新增 /
        //    方言特有列），只替换 application_id，保持其余属性与时间戳一致
        const { sql, params } = buildApplicationCopyInsert(oldApp as unknown as Record<string, unknown>, plan.newId);
        await database.run(sql, params);

        // 3. 将子表 application_versions 迁移到新 ID，并更新 file_path
        for (const v of plan.versions) {
          // 只替换路径首段（存储目录），避免误改文件名中恰好包含旧 ID 的部分
          const segments = v.file_path.split(/[\\/]/);
          const newFilePath =
            segments[0] === plan.oldId
              ? [plan.newId, ...segments.slice(1)].join('/')
              : v.file_path.replace(plan.oldId, plan.newId);
          await database.run(
            `UPDATE application_versions
             SET application_id = ?, file_path = ?
             WHERE version_id = ?`,
            [plan.newId, newFilePath, v.version_id]
          );
        }

        // 4. 将子表 application_execution_errors 迁移到新 ID
        await database.run(
          `UPDATE application_execution_errors
           SET application_id = ?
           WHERE application_id = ?`,
          [plan.newId, plan.oldId]
        );

        // 5. 删除原旧 ID 的 application 记录
        await database.run('DELETE FROM applications WHERE application_id = ?', [plan.oldId]);
      });

      // 6. 重命名存储目录（若存在）
      if (plan.oldStorageDir && fs.existsSync(plan.oldStorageDir)) {
        if (plan.newStorageDir && !fs.existsSync(plan.newStorageDir)) {
          fs.renameSync(plan.oldStorageDir, plan.newStorageDir);
        } else if (plan.newStorageDir) {
          // 若目标目录已存在，合并拷贝后删除源目录
          fs.cpSync(plan.oldStorageDir, plan.newStorageDir, { recursive: true });
          fs.rmSync(plan.oldStorageDir, { recursive: true, force: true });
        }
      }

      migratedCount++;
      console.log(`[SUCCESS] Migrated: ${plan.oldId} -> ${plan.newId} ("${plan.name}")`);
    } catch (err) {
      console.error(`[ERROR] Failed to migrate ${plan.oldId} -> ${plan.newId}:`, err);
      throw err;
    }
  }

  console.log('===============================================================');
  console.log(`[MIGRATION COMPLETE] Successfully migrated ${migratedCount} applications.`);
  console.log('===============================================================\n');

  return {
    total: apps.length,
    unchanged: unchangedCount,
    migrated: migratedCount,
    plans,
  };
}

// 直接运行模式
if (require.main === module) {
  const args = process.argv.slice(2);
  const shouldApply = args.includes('--apply') || args.includes('--force');

  runMigration({ apply: shouldApply })
    .then(() => {
      process.exit(0);
    })
    .catch((err) => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}
