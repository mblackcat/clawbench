# 工作台后端服务

基于 Node.js + Express + TypeScript 的 RESTful API 服务。

## 功能特性

- ✅ 用户认证和授权（JWT）
- ✅ 应用管理（创建、查询、更新、删除）
- ✅ 应用包上传和下载
- ✅ 版本管理
- ✅ 文件存储（本地文件系统）
- ✅ 数据持久化（SQLite / MySQL / PostgreSQL，通过 DB_TYPE 切换）
- ✅ 完整的错误处理和日志记录
- ✅ 200+ 测试用例

## 技术栈

- **运行时**: Node.js 18+
- **框架**: Express.js
- **语言**: TypeScript
- **数据库**: SQLite3 / MySQL 8 (mysql2) / PostgreSQL 16 (pg)
- **认证**: JWT (jsonwebtoken)
- **密码加密**: bcryptjs
- **文件上传**: multer
- **日志**: winston
- **测试**: Jest

## 快速开始

### 1. 安装依赖

```bash
cd backend
npm install
```

### 2. 配置环境变量

```bash
cp .env.example .env
# 编辑 .env 文件，修改 JWT_SECRET
```

### 3. 启动开发服务器

```bash
npm run dev          # 运行在 http://localhost:3000
```

### 4. 运行测试

```bash
npm test             # 运行所有测试（200+ 测试用例）
```

## 项目结构

```
backend/
├── src/
│   ├── __tests__/          # 测试文件
│   ├── config/             # 配置
│   ├── controllers/        # 控制器
│   ├── database/           # 数据库
│   ├── middleware/         # 中间件
│   ├── models/             # 数据模型
│   ├── repositories/       # 数据仓储
│   ├── routes/             # 路由
│   ├── services/           # 服务
│   ├── types/              # 类型定义
│   ├── utils/              # 工具函数
│   ├── app.ts              # Express 应用
│   └── index.ts            # 入口文件
├── data/                   # SQLite 数据库（MySQL/PG 时不使用）
├── uploads/                # 上传文件
└── logs/                   # 日志文件
```

## API 端点

### 用户 API
- `POST /api/v1/users/register` - 用户注册
- `POST /api/v1/users/login` - 用户登录
- `POST /api/v1/users/logout` - 用户注销
- `GET /api/v1/users/me` - 获取当前用户

### 应用 API
- `POST /api/v1/applications` - 创建应用
- `GET /api/v1/applications` - 获取应用列表
- `GET /api/v1/applications/:id` - 获取应用详情
- `PUT /api/v1/applications/:id` - 更新应用
- `DELETE /api/v1/applications/:id` - 删除应用
- `GET /api/v1/users/me/applications` - 获取用户的应用

### 文件 API
- `POST /api/v1/applications/:id/upload` - 上传应用包
- `GET /api/v1/applications/:id/download` - 下载应用包
- `GET /api/v1/applications/:id/versions` - 获取版本列表

## 开发命令

```bash
npm run dev          # 启动开发服务器（nodemon）
npm run build        # 构建生产版本
npm start            # 启动生产服务器
npm test             # 运行测试
npm run test:watch   # 监听模式运行测试
npm run test:coverage # 测试覆盖率
```

## 文档

- [安装指南](./SETUP.md) - 详细的安装和配置说明
- [API 文档](../docs/API_DOCUMENTATION.md) - 完整的 API 接口文档
- [应用市场系统](../docs/APP_MARKETPLACE.md) - 系统架构和功能说明

## 测试

后端包含 200+ 测试用例，覆盖：
- 基础设施测试
- 用户管理测试
- 认证系统测试
- 应用管理测试
- 文件存储测试

```bash
npm test                    # 运行所有测试
npm test -- user.test.ts    # 运行特定测试
npm run test:coverage       # 查看覆盖率
```

## 生产部署

```bash
# 1. 构建
npm run build

# 2. 配置环境变量
# 确保 .env 中 NODE_ENV=production 和 JWT_SECRET 已设置

# 3. 启动
npm start

# 或使用 PM2
pm2 start dist/index.js --name clawbench-backend
```

## 许可证

MIT
