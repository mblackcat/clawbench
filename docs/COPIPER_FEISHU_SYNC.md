# CoPiper ↔ 飞书电子表格同步

## 概述

一个 `.jdb` 文件可连接**一张**飞书电子表格（1:1）。连接配置写入 JDB 保留键 `__copiper__`，团队共享；读写使用**当前用户飞书 OAuth 身份**（与登录同一平台 App）。

仅 **服务端飞书登录** 可用；密码登录禁用该功能。

## 功能

| 能力 | 说明 |
|------|------|
| 创建 / 关联 | 新建云表或粘贴 URL；必须为每个子表指定 sheet 映射 |
| Test | 检查读/写权限 |
| 双向同步 | 按行指纹（相对上次同步点）合并；冲突弹窗 |
| Schema | 飞书表头可新增列 / 安全 rename 反写 JDB |
| 状态灯 | 侧栏文件节点：绿=健康，红=断开，琥珀=冲突 |
| 监听 | 本地 revision 轮询（默认 15s）+ 后端 drive 事件 SSE 增强 |

## JDB 元数据

```json
{
  "__copiper__": {
    "version": 1,
    "feishu": {
      "spreadsheetUrl": "https://xxx.feishu.cn/sheets/shtxxx",
      "spreadsheetToken": "shtxxx",
      "enabled": true,
      "syncMode": "bidirectional",
      "pollIntervalSec": 15,
      "sheetMaps": [
        {
          "jdbTable": "ItemData",
          "sheetId": "0b12",
          "sheetTitle": "ItemData",
          "headerMode": "name",
          "keyColumn": "id",
          "headerRow": 1,
          "dataStartRow": 2
        }
      ]
    }
  },
  "ItemData": { "columns": [], "rows": [] }
}
```

- **不存** access_token（本机 auth.store）
- 行指纹 `rowHashes` 存本机 electron-store，不入 jdb

## 平台 App 权限（运维）

登录用飞书应用需开通用户侧电子表格相关权限，例如：

- 查看、评论、编辑和管理电子表格
- 查看、评论和导出电子表格  
- 创建电子表格

用户重新授权后生效。事件增强另需在开放平台配置 `drive.file.edit_v1` 回调到：

`POST {API}/api/v1/feishu/callback`

桌面端 SSE：`GET {API}/api/v1/feishu/events/stream`（JWT）。

## 架构文件

| 文件 | 职责 |
|------|------|
| `jdb-meta.ts` | `__copiper__` 过滤与读写 |
| `feishu-sheets.client.ts` | OpenAPI UAT client |
| `copiper-feishu-sync.service.ts` | 双向同步引擎 |
| `copiper-feishu-watcher.service.ts` | 轮询 + SSE + 本地保存推送 |
| `backend/.../feishuDriveEventService.ts` | 事件 fan-out |
| `backend/.../feishuEventRoutes.ts` | callback + SSE |

## 使用

1. 飞书账号登录 ClawBench  
2. CoPiper 打开 JDB → 右键文件 → **连接飞书表格**  
3. 创建或关联 → 映射全部子表 → **测试连通性** → 保存  
4. 侧栏绿灯后，本地保存会 debounce 推送；云端改动靠轮询/事件拉取  
5. 冲突时按行选择保留本地/云端
