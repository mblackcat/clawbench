/**
 * common_apps 内置通用应用种子数据（三方言共用）。
 *
 * Schema 初始化时幂等写入（sqlite: INSERT OR IGNORE / mysql: INSERT IGNORE /
 * postgres: ON CONFLICT DO NOTHING），已存在的行不会被覆盖，
 * 因此 admin 对这些行的修改在重启后依然保留。
 *
 * ClawBench ships with NO builtin apps: the common-apps registry starts empty
 * and admins define entries (builtin or otherwise) via the web panel
 * (POST /api/v1/common-apps). The seed type + idempotent runner remain so
 * future bundled builtins can be added here without a migration.
 */

export interface CommonAppSeed {
  appKey: string;
  name: string;
  description: string;
  /** 内置应用版本号（缺省 1.0.0） */
  version?: string;
  sortOrder: number;
  /** 是否在工作台收藏栏置顶（admin 可改） */
  pinned: boolean;
  /** 全局默认配置（JSON 字符串） */
  config: string;
}

export const COMMON_APP_SEEDS: CommonAppSeed[] = [];

