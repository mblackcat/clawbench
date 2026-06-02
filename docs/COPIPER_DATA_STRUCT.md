# CoPiper 表格结构说明

> CoPiper 当前处于未开放状态（`moduleVisibility.copiper: false`），本文档描述其内部表格结构、行列布局与字段类型系统，作为后续开放前的内部参考。

## 1. 整体布局（运行时 Handsontable 渲染）

CoPiper 使用**单行表头 + 数据行**的简洁电子表格结构（不是 Excel/策划表那种多行表头）：

```
        ┌─────┬─────────┬───────────┬──────────┬──────────┬─────────┐
        │  #  │  id     │ idx_name  │  导出 ☑  │ 字段A   │ 字段B  │ ← 第 1 行：表头（colHeader）
        ├─────┼─────────┼───────────┼──────────┼──────────┼─────────┤
        │  1  │ 10001   │ apple     │   ☑     │  ...    │  ...   │ ← 第 1 行数据
        │  2  │ 10002   │ banana    │   ☑     │  ...    │  ...   │ ← 第 2 行数据
        │  3  │ 10003   │ ...       │   ☐     │  ...    │  ...   │
        └─────┴─────────┴───────────┴──────────┴──────────┴─────────┘
         ↑      ↑          ↑           ↑
       行号    第1列      第2列        第3列
     (rowHeaders)
```

| 位置 | 内容 |
|------|------|
| 最左列（行号） | Handsontable 自动行号（`rowHeaders={true}`），非数据，仅用于选择 |
| **第 1 行（表头）** | 列标题，格式 `rname <span>(name)</span>`，例 `角色名 (char_name)` |
| **第 1 行数据** | 紧贴表头开始（无第二行类型注释，类型存在 `columns[].j_type` 元数据里） |
| **第 1 列（数据）** | `id`（主键，int）— `c_index=1` |
| **第 2 列** | `idx_name`（索引名，str）— 被其他表引用时使用 |
| **第 3 列** | `_should_export`（系统列，bool，复选框）— 是否参与导出 |
| **第 4 列起** | 用户自定义业务字段 |

> `c_index=0` 的 `rdesc`（注释列）在表格视图里被过滤掉（`CopiperTable.tsx:351`：`.filter(col => col.c_type !== 'rdesc')`），不会显示。

## 2. 列分类（`c_type`）—— 三种语义角色

| c_type | 含义 | 是否显示 | 是否导出 |
|---|---|---|---|
| `data` | 业务数据列 | ✅ | ✅ |
| `sup` | 系统辅助列（如 `_should_export`） | ✅（只读） | ❌（不写入产物） |
| `rdesc` | 表头注释/说明列 | ❌（过滤掉） | ❌ |

## 3. 必填性（`req_or_opt`）

| 值 | 含义 |
|---|---|
| `required` | 必填，空值触发 error 级校验 |
| `optional` | 可选 |

## 4. 字段类型（`j_type` / `type`）—— 完整列表

### 4.1 基础原子类型

| j_type | 编辑器 | 含义 | 备注 |
|---|---|---|---|
| `str` | 文本 | 字符串 | |
| `int` | 数字 | 整数 | 支持 `0x` 十六进制 |
| `float` | 数字 | 浮点数 | |
| `bool` | 复选框 | 布尔 | |
| `enum` | 下拉 | 枚举 | 选项来自 `options`（管道分隔或数组） |

### 4.2 引用类型（跨行/跨表）

| j_type | 编辑器 | 含义 |
|---|---|---|
| `index` / `index/<Table>` | 下拉 | **单引用**，从 `src` 指向的表的 `idx_name` 列取值，导出时解析为目标 `id` |
| `indices` / `list:index` | 下拉/文本 | **多引用**，管道分隔的 `idx_name` 列表 |
| `istr` | 文本 | 索引字符串 `<Table>[idx_name]`，运行时按引用解析 |

`src` 字段存储目标表名；跨 JDB 文件引用时通过 `referenceData` 加载下拉选项。

### 4.3 时间类型

| j_type | 编辑器 | 含义 |
|---|---|---|
| `utc_time` | 日期选择 | UTC 时间戳 |
| `utc_time:+8` | 日期选择 | 带时区偏移的时间戳（冒号后为时区） |

### 4.4 结构化类型

| j_type | 编辑器 | 含义 |
|---|---|---|
| `kv:<Name>` | JSON Modal | 命名结构体（key-value），子字段定义在同名的结构表中 |
| `ckv:<Name>` | JSON Modal | **条件 KV**，多了一个 `cls` 类名字段做多态判别 |
| `dict` | JSON Modal | 通用字典 |
| `tstr` | 文本 | 模板字符串，含占位符 |

### 4.5 列表类型

| j_type | 编辑器 | 含义 |
|---|---|---|
| `list:str` / `list:int` / `list:float` / `list:bool` | 文本 | 管道分隔的同类型列表，按子类型解析 |
| `list:kv:<Name>` | JSON Modal | KV 结构体列表，若子结构有 `is_key=true` 字段则导出时转为 keyed dict |
| `list:ckv` | JSON Modal | CKV 列表 |
| `list:index` | 文本 | 等同于 `indices`（idx_name 列表） |

## 5. 行级固定字段（`RowData`）

每行除业务字段外，固定包含：

| 字段 | 类型 | 含义 |
|---|---|---|
| `id` | int/str | 主键，全表唯一（校验规则） |
| `idx_name` | str | 索引名，被其他表 `index/*` 引用时通过它查找 |
| `_should_export` | bool | 是否导出该行（系统 `sup` 列） |
| `_deprecated` | bool | 是否废弃 |
| `[任意 key]` | any | 由 `columns[].name` 定义的动态业务字段 |

## 6. 磁盘 JSON 形态（.jdb 文件）

`.jdb` 本质是 JSON：

```json
{
  "ItemData": {
    "columns": [
      { "id":"rdesc",          "name":"rdesc",          "rname":"注释",   "j_type":"str",  "c_type":"rdesc", "c_index":0, "req_or_opt":"optional", "src":"" },
      { "id":"id",             "name":"id",             "rname":"ID",     "j_type":"int",  "c_type":"data",  "c_index":1, "req_or_opt":"required", "src":"", "is_key":true },
      { "id":"idx_name",       "name":"idx_name",       "rname":"索引名", "j_type":"str",  "c_type":"data",  "c_index":2, "req_or_opt":"required", "src":"" },
      { "id":"_should_export", "name":"_should_export", "rname":"导出",   "j_type":"bool", "c_type":"sup",   "c_index":3, "req_or_opt":"optional", "default_v":true, "src":"" }
    ],
    "rows": [
      { "id":10001, "idx_name":"apple",  "_should_export":true,  "count":100 },
      { "id":10002, "idx_name":"banana", "_should_export":true,  "count":50  }
    ]
  }
}
```

**要点**：磁盘上每行只是一个 `{ name: value }` 的对象，**类型信息不存在行里**，全靠 `columns[]` 元数据驱动渲染、校验与导出解析。这就是为什么 UI 里只有一行表头、数据从第 1 行就开始 —— 类型注释已经隔离到 schema 层了。

## 7. 列定义（`ColDef`）字段速查

| 字段 | 含义 |
|---|---|
| `id` | 列唯一标识 |
| `name` | 字段名（数据 key） |
| `rname` | 显示名称（UI 表头展示） |
| `type` | 原始类型字符串，如 `index/ResourceData`、`list:kv:item_list` |
| `j_type` | 统一规范类型，如 `index`、`list:kv:item_list`、`utc_time:+8` |
| `c_type` | `data` / `sup` / `rdesc` |
| `c_index` | 列显示顺序 |
| `req_or_opt` | `required` / `optional` |
| `default_v` | 默认值 |
| `src` | 引用源表名（index/indices 类型使用） |
| `options` | 枚举选项（管道分隔或数组） |
| `is_key` | 是否主键（list:kv 转 keyed dict 用） |
| `rdesc` / `note` / `formula` | 注释、备注、计算公式 |
| `cs` | 客户端/服务器标记 |
