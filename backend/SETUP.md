# 后端服务安装指南

## 系统要求

- Node.js >= 18.x
- npm >= 8.x

## 快速安装

### 1. 安装依赖

```bash
cd backend
npm install
```

### 2. 配置环境变量

```bash
cp .env.example .env
```

编辑 `.env` 文件，**必须修改**以下配置：

```env
# 生产环境必须使用强随机密钥
JWT_SECRET=your-secure-random-secret-key-here

# 可选配置
PORT=3000
NODE_ENV=development

# 数据库配置（默认 SQLite，可选 mysql / postgres）
DB_TYPE=sqlite
DB_PATH=./data/marketplace.db

# MySQL / PostgreSQL 连接配置（DB_TYPE 非 sqlite 时需要）
# DB_HOST=127.0.0.1
# DB_PORT=3306
# DB_NAME=clawbench
# DB_USER=clawbench
# DB_PASSWORD=clawbench
```

### 3. 启动服务

```bash
npm run dev          # 开发模式（支持热重载）
```

### 4. 验证安装

```bash
curl http://localhost:3000/health
```

应该返回：
```json
{
  "status": "ok",
  "timestamp": "2024-02-17T00:00:00.000Z"
}
```

## 目录说明

首次启动时会自动创建以下目录：

- `data/` - SQLite 数据库文件（使用 MySQL/PostgreSQL 时不需要此目录）
- `uploads/` - 上传的应用包文件
- `logs/` - 应用日志文件

这些目录已在 `.gitignore` 中排除。

## 常见问题

### 端口被占用
修改 `.env` 文件中的 `PORT` 配置。

### 权限错误
确保应用有权限创建 `data/`、`uploads/` 和 `logs/` 目录。

### 数据库锁定
确保没有其他进程在使用数据库文件。

## 生产部署

### 1. 构建项目

```bash
npm run build
```

### 2. 配置生产环境

确保 `.env` 文件配置正确：
```env
NODE_ENV=production
JWT_SECRET=<strong-random-key>
PORT=3000
```

### 3. 启动服务

```bash
npm start
```

### 4. 使用进程管理器（推荐）

使用 PM2 管理进程：

```bash
npm install -g pm2
pm2 start dist/index.js --name clawbench-backend
pm2 save
pm2 startup
```

## 更多文档

- [后端 README](./README.md) - 项目概述
- [API 文档](../docs/API_DOCUMENTATION.md) - 完整的 API 接口文档
