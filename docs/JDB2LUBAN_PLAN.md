# CoPiper JDB → Luban 快速落地 Plan（方案 1：中间产物桥接）

> 状态：实施中（CoPiper 导出已支持 Luban 格式）  
> 日期：2026-07-20  
> 目标：原始表在 CoPiper 维护（`.jdb`），经临时中间产物接入 Luban 导表流程，生成二进制配置 + schema 代码到工程内使用。

---

## 1. 背景与目标

### 1.1 目标

| 项 | 说明 |
|----|------|
| 编辑真源 | CoPiper 维护 `.jdb` |
| 编译器 | 工作区内的 Luban（`tools/Luban`） |
| 中间产物 | 允许（schema / JSON 缓存，可不入库） |
| 最终产物 | 二进制数据 + 目标语言 schema 代码，写入工程约定目录 |
| 原则 | **不破坏原生 CoPiper 导出**；不 fork Luban |

### 1.2 非目标（本阶段不做）

- 不写 Luban 原生 `.jdb` DataLoader / SchemaCollector 插件
- 不强制替换已有 Excel 表（可并行共存）
- 不一次覆盖 CoPiper 全部冷门类型（`istr` / `tstr` / 复杂 `ckv` 可后续迭代）

---

## 2. 推荐工作区约定（相对路径）

工程工作区建议具备（均可按项目调整，导出面板可覆盖）：

```
{workspace}/
├── tools/Luban/                 # Luban 工具链（Luban.dll + Templates）
├── config/
│   ├── luban.conf
│   ├── Defines/                 # 正式 schema（XML 等）
│   │   └── _jdb_gen/            # CoPiper 生成的 schema 草稿（可审查后合并）
│   └── Datas/
│       └── _jdb/                # CoPiper 生成的中间 JSON 记录列表
├── data/**/*.jdb                # CoPiper 编辑真源（或任意 jdb 目录）
└── output/luban/
    ├── code/                    # Luban 代码输出（-x outputCodeDir）
    └── data/                    # Luban 数据输出（-x outputDataDir）
```

### 2.1 典型 Luban 调用

```bat
dotnet tools\Luban\Luban.dll
  -t all
  -c cpp-sharedptr-bin
  -d json
  -d bin
  --conf config\luban.conf
  -x outputCodeDir=output\luban\code
  -x outputDataDir=output\luban\data
  -x outputSaver.bin.cleanUpOutputDir=0
  -x outputSaver.json.cleanUpOutputDir=0
```

code / data target、输出目录均按工程自行选择；上表仅为默认相对路径约定。

### 2.2 Schema / 表约定（摘要）

| 约定 | 建议 |
|------|------|
| 模块 | XML `<module name="...">` |
| 表名 | `Tb` + 记录类型名 |
| value bean | 与记录结构同名 |
| 主键 | `id`（int），`mode=map` |
| input | 相对 `Datas/`；JDB 桥接用 `*@_jdb/{TableName}.json` |
| output | 短名 snake_case → `{outputDataDir}/{output}.*` |
| 字段命名 | schema / JSON key 使用 `columns.name` |

### 2.3 CoPiper 侧能力

| 能力 | 状态 |
|------|------|
| 原生 Python / JSON 导出 | ✅ 保留，可与 Luban 多选并存 |
| JDB → Luban 中间 JSON | ✅ 导出选 Luban |
| schema XML 草稿 | ✅ `Defines/_jdb_gen` |
| 可选调用 Luban CLI | ✅ 工作区有 dll + conf 时 |

---

## 3. 目标架构（方案 1）

```
                    ┌──────────────────────┐
   策划/程序编辑    │  CoPiper (.jdb)       │  唯一编辑真源
                    └──────────┬───────────┘
                               │ 导出选 Luban
                               ▼
                    ┌──────────────────────┐
   中间产物(可临时) │  config/Datas/_jdb/  │  Luban JSON 记录列表
                    │  Defines/_jdb_gen/   │  schema 草稿（可审查）
                    └──────────┬───────────┘
                               │ 可选：dotnet Luban.dll
                               ▼
                    ┌──────────────────────┐
   工程内产物       │  output/luban/code   │  schema 代码
                    │  output/luban/data   │  bin / json 等
                    └──────────────────────┘
```

**原则：**

1. `.jdb` = 编辑真源  
2. `_jdb` / `_jdb_gen` = 纯生成、可删可重建  
3. 正式 `Defines/*.xml` 可继续手写维护；草稿生成后人工 merge  
4. Excel 表可与 JDB 表 **并存**（不同 `input` 指向不同源）  
5. 原生 Python / JSON 导出与 Luban 互不影响  

---

## 4. 分阶段落地 Plan

### Phase 0 — 验证链路

**目的：** 证明「中间 JSON + 既有 schema」能被 Luban 正常消费。

1. 选一张结构简单的业务表（主键 `id` + 若干基础字段）  
2. 写出 Luban 记录列表 JSON 到 `config/Datas/_jdb/{TableName}.json`  
3. 在正式 schema 中将该表 `input` 指向 `*@_jdb/{TableName}.json`  
4. 运行 Luban，检查代码与数据输出、运行时按主键查询  

中间 JSON 形态：

- 根为**记录数组**（不是 CoPiper 原生 `{ "data": [...] }`）  
- 字段名 = schema `var name`  
- `list` 用 JSON 数组；`map` 用 `[[k,v],...]`  

**Done：** 至少一张表从非 Excel 源成功导出并被工程加载。

---

### Phase 1 — 转换器（已内置于 CoPiper）

实现位置：`frontend/src/main/services/jdb2luban.service.ts`  
触发：CoPiper 导出对话框勾选 **Luban**。

#### 1.1 转换规则（类型白名单）

| JDB `j_type` | 输出 JSON | 备注 |
|--------------|-----------|------|
| `int` | number | 支持 `0x` 先规范化 |
| `float` | number | |
| `bool` | bool | |
| `str` | string | |
| `enum` | string 或 int | 与 XML enum 对齐 |
| `list:int` / `list:str` / … | 数组 | 管道拆分 |
| `index` / `index/X` | number（id） | **必须** `idx_name→id`，扫全部 jdb |
| `indices` / `list:index` | number[] | 同上 |
| `kv:Name` | object | 结构表不导出为 table |
| `list:kv:Name` | object[] 或 map 的 `[[k,v]]` | 有 `is_key` 时转 map 形态 |
| 其它 | 告警 / fallback | 避免静默错误 |

行处理：

- 跳过 `_should_export === false`  
- 不导出 `c_type` 为 `sup` / `rdesc` 的列  
- 默认不导出 `idx_name`（仅用于引用解析）  

#### 1.2 可选外置 CLI / gen 串联

若 CI 需要独立命令行，可另置 `tools/jdb2luban`，逻辑与内置转换对齐即可。也可在 `gen.bat` 前串联 convert。

#### 1.3 Schema

- CoPiper 生成草稿：`config/Defines/_jdb_gen/{table}.xml`  
- 正式导出以 `luban.conf` 的 `schemaFiles` 为准；草稿需人工审查后并入 `Defines/`  
- 每张 JDB 表：`input="*@_jdb/{TableName}.json"`，`output` 与运行时加载名一致  

---

### Phase 2 — CoPiper 工作流（已实现）

| 改动点 | 说明 |
|--------|------|
| 导出格式 | 多选 Python / JSON / **Luban**；原生格式保留 |
| Luban 流程 | 中间 JSON + schema 草稿 → 可选 `dotnet Luban.dll` |
| 路径 | 默认相对工作区，面板可覆盖 |
| 文档链接 | 官方文档 + GitHub 展示在导出面板 |

**Done：** 编辑 jdb → 导出选 Luban → 得到中间产物 / CLI 输出。

---

### Phase 3 — Schema 半自动 / 类型扩展（按需）

1. 从 `columns[]` 生成 bean 字段并 diff 合并进正式 Defines  
2. `enum` / `kv` 结构 bean / `ckv` 多态（JSON `$type`）  
3. `#ref=` 自动挂上（目标表全名由命名约定推导）  
4. `cs` 列 → Luban group  

---

## 5. 目录与 Git 约定（建议）

```
config/
  Datas/_jdb/          # 可不入库：中间 JSON
  Defines/             # 入库：正式 schema
  Defines/_jdb_gen/    # 可不入库：schema 草稿
  luban.conf
  gen.bat              # 可选
```

`.gitignore` 建议：

```
config/Datas/_jdb/
config/Defines/_jdb_gen/
```

生成的代码与数据是否入库，按团队现有策略。

---

## 6. 类型与命名硬约定

1. **主键**：业务表必须有 `id`（int），Luban `index="id"`。  
2. **`idx_name`**：仅 CoPiper 编辑/引用；默认不进最终数据。  
3. **表输出名 `output`**：稳定短名，与数据文件名、loader 回调一致。  
4. **模块名**：与 `Defines` 文件 / 业务域一致。  
5. **字段名**：JDB `columns.name` ≡ XML `var name` ≡ JSON key。  
6. **列表**：JDB 内管道分隔；中间 JSON 必须是数组。  
7. **引用**：中间层解析为 id；XML 可补 `#ref=` 做 Luban 校验。  
8. **结构表**：只作为 `kv:` / `ckv:` 目标，不单独导出为 table。  

---

## 7. 验收清单

### 功能

- [ ] 修改 jdb → 导出 Luban → 中间 JSON 更新  
- [ ] `_should_export=false` 不进中间数据  
- [ ] 跨 jdb 的 `index` 引用解析正确  
- [ ] 仅选 Python/JSON 时行为与改前一致  
- [ ] 开启 CLI 且工具链齐全时 Luban 退出码 0  

### 工程

- [ ] 中间产物可不入库  
- [ ] 默认路径均为相对工作区，可覆盖  
- [ ] 文档与 UI 无具体业务表示例配置  

---

## 8. 风险与对策

| 风险 | 对策 |
|------|------|
| JSON 字段名与 schema 不一致 | 统一用 `columns.name` |
| index 跨文件漏扫 | convert 扫工作区全部 jdb 建引用表 |
| 结构表被当成数据表导出 | 只导出用户勾选的业务表 |
| Excel + JDB 双源混乱 | 一表只允许一种 input |
| schema 草稿误用进生产 | `_jdb_gen` 仅草稿，正式 Defines 走审查 |
| 缺少 dll/conf | CLI 跳过或失败信息中说明，中间产物仍写出 |

---

## 9. 默认相对路径速查（相对工作区根）

| 用途 | 默认相对路径 |
|------|----------------|
| Luban 工具 | `tools/Luban/Luban.dll` |
| Luban 配置 | `config/luban.conf` |
| 中间 JSON | `config/Datas/_jdb/` |
| Schema 草稿 | `config/Defines/_jdb_gen/` |
| 代码输出 | `output/luban/code` |
| 数据输出 | `output/luban/data` |
| CoPiper 文档 | `docs/COPIPER.md`、`docs/COPIPER_DATA_STRUCT.md` |
| 本 Plan | `docs/JDB2LUBAN_PLAN.md` |
| 官方文档 | https://www.datable.cn/docs/intro |
| 源码 | https://github.com/focus-creative-games/luban |

---

## 10. 决策记录（默认，可改）

| 议题 | 默认决策 |
|------|----------|
| 中间产物位置 | `config/Datas/_jdb/`（建议 gitignore） |
| Schema 草稿 | `config/Defines/_jdb_gen/`（建议 gitignore） |
| Schema 真源 | 正式 `Defines/` 审查后入库 |
| 与 Excel 关系 | 并存，按表迁移 |
| 原生导出 | 永久保留 Python / JSON |
| CoPiper 一键 Luban | 导出面板勾选即可 |

---

*文档结束。*
