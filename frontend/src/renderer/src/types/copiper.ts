// CoPiper 配表工具 - 类型定义

/** 基础字段类型 */
export type ColType =
  | 'str'
  | 'int'
  | 'float'
  | 'bool'
  | 'index'
  | 'indices'
  | 'ckv'
  | 'kv'
  | 'tstr'
  | 'istr'
  | 'list'
  | 'utc_time'
  | 'enum'
  | 'dict'

/**
 * 列定义 — 对应 JDB 文件中 columns 数组的每个元素
 *
 * `type` 字段存储的是原始类型字符串，可能包含子类型如 "index/TableName"、"list:kv:xxx"
 */
export interface ColDef {
  /** 唯一标识 */
  id: string
  /** 字段名（数据 key） */
  name: string
  /** 显示名称（UI 展示） */
  rname: string
  /** 原始类型字符串，如 "int"、"index/TableName"、"list:kv:item_list" */
  type: string
  /** 统一类型格式，如 "int"、"index"、"list:kv:item_list" */
  j_type: string
  /** "required" | "optional" */
  req_or_opt: string
  /** 默认值 */
  default_v?: unknown
  /** 列类别："data"（导出） | "sup"（辅助，不导出） | "rdesc"（注释行） */
  c_type: string
  /** 列显示顺序 */
  c_index: number
  /** 描述/注释 */
  rdesc?: string
  /** 备注 */
  note?: string
  /** 计算公式 */
  formula?: string
  /** 引用源表名（index/indices 类型使用） */
  src: string
  /** 枚举选项（管道分隔字符串或字符串数组） */
  options?: string | string[]
  /** 客户端/服务器标记 */
  cs?: string
  /** 是否主键 */
  is_key?: boolean
}

/** 行数据 — 动态 key/value + 固定系统字段 */
export interface RowData {
  /** 主键 ID */
  id: number | string
  /** 索引名称 */
  idx_name?: string
  /** 是否导出（系统字段） */
  _should_export?: boolean
  /** 是否废弃（系统字段） */
  _deprecated?: boolean
  /** 其余动态字段 */
  [key: string]: unknown
}

/** 单张表的数据 */
export interface JDBTableData {
  columns: ColDef[]
  rows: RowData[]
}

/** 整个 JDB 文件 — tableName → 表数据 */
export type JDBDatabase = Record<string, JDBTableData>

/** JDB 文件元信息 */
export interface JDBFileInfo {
  /** 文件名（不含路径） */
  fileName: string
  /** 完整路径 */
  filePath: string
  /** 相对于工作区的路径 */
  relativePath: string
  /** 文件大小（bytes） */
  size: number
  /** 最后修改时间 */
  modifiedAt: number
  /** 包含的表名列表 */
  tableNames: string[]
}

/** 表元数据 — 对应 tb_infos.jdb 的行 */
export interface TableInfo {
  /** 唯一 ID */
  id: string
  /** 组合键: "{rel_dir}_{db_name}_{tb_name}" */
  db_key: string
  /** 所属目录（如 "basic"） */
  rel_dir: string
  /** 表名（如 "CropData"） */
  ptb: string
  /** Excel 工作表名 */
  sheet_name: string
  /** 映射来源列（通常 "idx_name"） */
  from: string
  /** 映射目标列（通常 "id"） */
  to: string
  /** 关联源表列表 */
  src_list: string[]
  /** 是否使用 JDB 格式 */
  use_jdb: boolean
  /** 自动分文件数量 */
  auto_divide_num: number
  /** 描述 */
  desc?: string
}

/** 导出配置 */
export interface ExportConfig {
  /** 导出格式 */
  formats: ('python' | 'json')[]
  /** 输出基础目录（默认使用工作区路径） */
  outputDir?: string
  /** Python 文件头模板 */
  pythonHeader?: string
  /** 要导出的表名列表（空则全部导出） */
  tableNames?: string[]
  /** 导出的子目录（如 "game/common/data"） */
  exportSubDir?: string
}

/** 单张表的导出结果 */
export interface ExportResult {
  tableName: string
  format: 'python' | 'json'
  outputPath: string
  success: boolean
  error?: string
  rowCount: number
  /** 是否跳过（空表） */
  skipped?: boolean
  /** 检查脚本执行信息 */
  checkInfo?: string
  /** 后处理脚本执行信息 */
  postProcessInfo?: string
}

/** 数据验证问题 */
export interface ValidationIssue {
  /** 严重级别 */
  level: 'error' | 'warning'
  /** 所属表名 */
  tableName: string
  /** 行索引（-1 表示表级别问题） */
  rowIndex: number
  /** 行 ID */
  rowId?: number | string
  /** 列名（空表示行级别问题） */
  columnName?: string
  /** 问题描述 */
  message: string
}

/** CoPiper 设置（持久化） */
export interface CopiperSettings {
  /** 默认导出格式 */
  defaultFormats: ('python' | 'json')[]
  /** Python 文件头模板 */
  pythonHeader: string
  /** 导出子目录 */
  exportSubDir: string
}
