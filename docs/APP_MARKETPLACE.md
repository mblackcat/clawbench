# 应用市场系统文档

## 概述

应用市场系统是 ClawBench 的核心功能之一，提供完整的应用生命周期管理，包括应用发布、安装、更新、卸载等功能。

## 系统架构

### 技术栈

**后端**
- Node.js + Express + TypeScript
- SQLite / MySQL / PostgreSQL 数据库（通过 DB_TYPE 切换）
- JWT 认证
- Multer 文件上传
- Winston 日志

**前端**
- React + TypeScript
- Ant Design UI
- Zustand 状态管理
- Fetch API

## 核心功能

### 1. 用户管理
- ✅ 用户注册（用户名、邮箱、密码）
- ✅ 用户登录（JWT 认证）
- ✅ 用户注销（令牌失效）
- ✅ 获取当前用户信息
- ✅ 密码哈希和验证

### 2. 应用管理
- ✅ 创建应用（名称、描述、分类、元数据）
- ✅ 更新应用信息
- ✅ 删除应用
- ✅ 查询应用列表（分页、搜索、筛选）
- ✅ 查询应用详情
- ✅ 查询用户的应用
- ✅ 应用所有权验证

### 3. 文件管理
- ✅ 应用包上传（multipart/form-data）
- ✅ 应用包下载
- ✅ 版本管理（多版本支持）
- ✅ 版本历史查询
- ✅ 文件格式验证
- ✅ 下载计数统计

### 4. 前端功能
- ✅ API 客户端服务（认证、错误处理）
- ✅ 应用管理器（安装、卸载、更新）
- ✅ 本地存储管理器（已安装应用、置顶配置）
- ✅ 【已装应用】页签（置顶区域 + 其他应用 + 本地应用）
- ✅ 【应用中心】页签（开发者应用 + 所有应用）
- ✅ 应用详情页（完整信息、版本历史）
- ✅ 应用运行功能（实时日志输出）
- ✅ 置顶应用功能
- ✅ 版本检查和更新
- ✅ 错误处理和用户提示

## API 端点

### 用户 API
```
POST   /api/v1/users/register    # 用户注册
POST   /api/v1/users/login       # 用户登录
POST   /api/v1/users/logout      # 用户注销
GET    /api/v1/users/me          # 获取当前用户
```

### 应用 API
```
POST   /api/v1/applications                      # 创建应用
GET    /api/v1/applications                      # 获取应用列表
GET    /api/v1/applications/:id                  # 获取应用详情
PUT    /api/v1/applications/:id                  # 更新应用
DELETE /api/v1/applications/:id                  # 删除应用
GET    /api/v1/users/me/applications             # 获取用户的应用
```

### 文件 API
```
POST   /api/v1/applications/:id/upload           # 上传应用包
GET    /api/v1/applications/:id/download         # 下载应用包
GET    /api/v1/applications/:id/versions         # 获取版本列表
```

## 数据模型

### User（用户）
```typescript
{
  userId: string;        // UUID
  username: string;      // 唯一
  email: string;         // 唯一
  passwordHash: string;
  createdAt: number;     // Unix timestamp
  updatedAt: number;
}
```

### Application（应用）
```typescript
{
  applicationId: string;  // UUID
  name: string;
  description: string;
  ownerId: string;        // 外键 -> User
  category: string;
  published: boolean;
  downloadCount: number;
  metadata: object;
  createdAt: number;
  updatedAt: number;
}
```

### ApplicationVersion（应用版本）
```typescript
{
  versionId: string;      // UUID
  applicationId: string;  // 外键 -> Application
  version: string;        // 语义化版本
  changelog: string;
  filePath: string;
  fileSize: number;
  publishedAt: number;
}
```

### InstalledApp（已安装应用）
```typescript
{
  ...Application,
  installedAt: number;
  installPath: string;
  pinned: boolean;
  pinnedOrder: number;
  hasUpdate: boolean;
  localVersion: string;
}
```

## 前端服务层

### API 客户端 (`apiClient.ts`)
提供与后端 API 通信的封装：
- HTTP 方法封装（GET, POST, PUT, DELETE）
- JWT 令牌自动管理
- 请求拦截和错误处理
- 文件上传和下载

### 应用管理器 (`applicationManager.ts`)
管理应用的完整生命周期：
- 应用列表获取和缓存
- 应用安装（下载并保存到本地）
- 应用卸载（删除文件和记录）
- 应用更新（卸载旧版本，安装新版本）
- 版本检查和比较
- 置顶应用管理

### 本地存储管理器 (`localStorageManager.ts`)
管理本地数据持久化：
- 已安装应用信息
- 置顶应用配置
- 安装目录配置

## 页面组件

### 已装应用页面 (`InstalledAppsPage.tsx`)
显示用户已安装的应用：
- **置顶应用区域**：显示用户置顶的应用
- **其他应用区域**：显示其他已安装应用和本地创建的应用
- **功能**：
  - 本地应用：编辑、运行
  - 已安装应用：运行、更新（如有）
  - 实时输出日志抽屉
  - 未读日志计数
  - 停止运行功能

### 应用中心页面 (`AppLibraryPage.tsx`)
浏览和管理所有应用：
- **我的应用区域**：显示用户开发的应用（本地和已发布）
- **所有应用区域**：显示所有已发布的应用
- **功能**：
  - 创建新应用入口
  - 应用搜索
  - 本地应用：编辑、代码、发布
  - 已发布应用：编辑、代码、下架
  - 其他应用：查看、安装/运行/更新

### 应用详情页 (`AppDetailPage.tsx`)
显示应用的完整信息：
- 应用基本信息
- 版本历史时间线
- 安装/更新/卸载按钮
- 开发者管理入口

### 应用编辑器 (`AppEditor.tsx`)
4步创建应用流程：
1. 基本信息（名称、描述、版本）
2. 参数定义
3. 预览确认
4. 生成代码（自动跳转到代码编辑器）

### 代码编辑器 (`CodeEditor.tsx`)
编辑应用代码：
- 文件树显示
- 多标签编辑
- Monaco 编辑器
- 运行调试功能
- 实时输出日志

### 应用发布页 (`AppPublisher.tsx`)
4步发布应用流程：
1. 选择应用
2. 创建/更新应用元数据
3. 上传应用包（待实现）
4. 完成

## 运行说明

### 启动后端服务
```bash
cd backend
npm install
npm run dev          # 开发模式（端口 3000）
npm test            # 运行测试（200+ 测试用例）
```

### 启动前端应用
```bash
cd frontend
npm install
npm run dev         # 开发模式（端口 5173）
```

### 环境配置
后端需要配置 `.env` 文件：
```env
PORT=3000
JWT_SECRET=your-secret-key
JWT_EXPIRES_IN=7d
UPLOAD_DIR=./uploads
DATABASE_PATH=./data/marketplace.db
LOG_LEVEL=info
LOG_DIR=./logs
```

## 测试覆盖

### 后端测试（200+ 测试用例）
- ✅ 基础设施测试
- ✅ 用户管理测试（模型、仓储、注册、认证）
- ✅ JWT 令牌测试
- ✅ 认证中间件测试
- ✅ 应用管理测试（模型、仓储、CRUD、版本）
- ✅ 文件存储测试
- ✅ 应用上传下载测试

### 前端测试
- ✅ API 客户端测试

## 实现状态

### 已完成功能
- ✅ 完整的后端 RESTful API（15+ 端点）
- ✅ 用户认证和授权系统
- ✅ 应用生命周期管理
- ✅ 文件上传和下载
- ✅ 版本管理和更新
- ✅ 前端应用管理界面
- ✅ 本地应用创建和编辑
- ✅ 应用运行和日志输出
- ✅ 应用发布流程（元数据部分）

### 待完善功能
1. **文件系统 IPC 调用**
   - 应用包的实际保存和删除需要通过 Electron IPC
   - 需要在 `frontend/src/main/ipc/` 添加文件操作处理器

2. **应用发布完善**
   - 应用包打包（zip）
   - 文件上传实现

3. **用户体验优化**
   - 安装/下载进度显示
   - 操作确认对话框
   - 加载骨架屏

4. **性能优化**
   - 应用列表虚拟滚动
   - 图片懒加载
   - 缓存策略优化

## 未来改进方向

1. 应用评分和评论功能
2. 应用分类和标签系统
3. 应用搜索优化（全文搜索）
4. 应用依赖管理
5. 应用权限管理
6. 应用自动更新检查
7. 应用使用统计和分析
8. 多语言支持

## 相关文档

- [后端 API 设计](../backend/API_DESIGN.md)
- [后端安装指南](../backend/SETUP.md)
- [API 文档](./API_DOCUMENTATION.md)
- [项目状态](./PROJECT_STATUS.md)
