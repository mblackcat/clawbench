# API 文档

## 基础信息

- **Base URL**: `http://localhost:3000/api/v1`
- **认证方式**: JWT Bearer Token
- **Content-Type**: `application/json`（除文件上传外）

## 认证

大部分 API 需要在请求头中携带 JWT 令牌：

```
Authorization: Bearer <your-jwt-token>
```

## 响应格式

### 成功响应
```json
{
  "success": true,
  "data": {
    // 响应数据
  }
}
```

### 错误响应
```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "错误描述",
    "details": {} // 可选的详细信息
  }
}
```

## 错误代码

| 错误代码 | HTTP 状态码 | 说明 |
|---------|-----------|------|
| `UNAUTHORIZED` | 401 | 未认证 |
| `INVALID_TOKEN` | 401 | 令牌无效 |
| `TOKEN_EXPIRED` | 401 | 令牌过期 |
| `FORBIDDEN` | 403 | 无权限 |
| `VALIDATION_ERROR` | 400 | 验证错误 |
| `NOT_FOUND` | 404 | 资源不存在 |
| `ALREADY_EXISTS` | 409 | 资源已存在 |
| `INTERNAL_ERROR` | 500 | 服务器内部错误 |

---

## 用户 API

### 1. 用户注册

**POST** `/users/register`

创建新用户账户。

**请求体**
```json
{
  "username": "string",  // 3-30字符，字母数字下划线
  "email": "string",     // 有效的邮箱地址
  "password": "string"   // 最少8字符
}
```

**响应**
```json
{
  "success": true,
  "data": {
    "user": {
      "userId": "uuid",
      "username": "string",
      "email": "string",
      "createdAt": 1234567890,
      "updatedAt": 1234567890
    },
    "token": "jwt-token"
  }
}
```

**错误**
- `VALIDATION_ERROR`: 输入验证失败
- `ALREADY_EXISTS`: 用户名或邮箱已存在

---

### 2. 用户登录

**POST** `/users/login`

用户登录获取 JWT 令牌。

**请求体**
```json
{
  "email": "string",
  "password": "string"
}
```

**响应**
```json
{
  "success": true,
  "data": {
    "user": {
      "userId": "uuid",
      "username": "string",
      "email": "string",
      "createdAt": 1234567890,
      "updatedAt": 1234567890
    },
    "token": "jwt-token"
  }
}
```

**错误**
- `VALIDATION_ERROR`: 输入验证失败
- `UNAUTHORIZED`: 邮箱或密码错误

---

### 3. 用户注销

**POST** `/users/logout`

注销当前用户，使令牌失效。

**请求头**
```
Authorization: Bearer <token>
```

**响应**
```json
{
  "success": true,
  "data": {
    "message": "Logged out successfully"
  }
}
```

**错误**
- `UNAUTHORIZED`: 未认证或令牌无效

---

### 4. 获取当前用户

**GET** `/users/me`

获取当前登录用户的信息。

**请求头**
```
Authorization: Bearer <token>
```

**响应**
```json
{
  "success": true,
  "data": {
    "userId": "uuid",
    "username": "string",
    "email": "string",
    "createdAt": 1234567890,
    "updatedAt": 1234567890
  }
}
```

**错误**
- `UNAUTHORIZED`: 未认证或令牌无效

---

## 应用 API

### 5. 创建应用

**POST** `/applications`

创建新应用。

**请求头**
```
Authorization: Bearer <token>
```

**请求体**
```json
{
  "name": "string",           // 必需，应用名称
  "description": "string",    // 必需，应用描述
  "category": "string",       // 可选，应用分类
  "metadata": {}              // 可选，元数据对象
}
```

**响应**
```json
{
  "success": true,
  "data": {
    "applicationId": "uuid",
    "name": "string",
    "description": "string",
    "ownerId": "uuid",
    "category": "string",
    "published": false,
    "downloadCount": 0,
    "metadata": {},
    "createdAt": 1234567890,
    "updatedAt": 1234567890
  }
}
```

**错误**
- `UNAUTHORIZED`: 未认证
- `VALIDATION_ERROR`: 输入验证失败

---

### 6. 获取应用列表

**GET** `/applications`

获取已发布的应用列表，支持分页、搜索和筛选。

**查询参数**
- `page`: 页码（默认 1）
- `limit`: 每页数量（默认 20，最大 100）
- `search`: 搜索关键词（搜索名称和描述）
- `category`: 分类筛选
- `ownerId`: 按所有者筛选

**响应**
```json
{
  "success": true,
  "data": {
    "applications": [
      {
        "applicationId": "uuid",
        "name": "string",
        "description": "string",
        "ownerId": "uuid",
        "category": "string",
        "published": true,
        "downloadCount": 100,
        "metadata": {},
        "createdAt": 1234567890,
        "updatedAt": 1234567890
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 100,
      "totalPages": 5
    }
  }
}
```

---

### 7. 获取应用详情

**GET** `/applications/:id`

获取指定应用的详细信息，包括版本历史。

**路径参数**
- `id`: 应用 ID

**响应**
```json
{
  "success": true,
  "data": {
    "applicationId": "uuid",
    "name": "string",
    "description": "string",
    "ownerId": "uuid",
    "category": "string",
    "published": true,
    "downloadCount": 100,
    "metadata": {},
    "createdAt": 1234567890,
    "updatedAt": 1234567890,
    "versions": [
      {
        "versionId": "uuid",
        "version": "1.0.0",
        "changelog": "string",
        "fileSize": 1024,
        "publishedAt": 1234567890
      }
    ]
  }
}
```

**错误**
- `NOT_FOUND`: 应用不存在

---

### 8. 更新应用

**PUT** `/applications/:id`

更新应用信息（仅所有者可操作）。

**请求头**
```
Authorization: Bearer <token>
```

**路径参数**
- `id`: 应用 ID

**请求体**
```json
{
  "name": "string",        // 可选
  "description": "string", // 可选
  "category": "string",    // 可选
  "published": boolean,    // 可选
  "metadata": {}           // 可选
}
```

**响应**
```json
{
  "success": true,
  "data": {
    "applicationId": "uuid",
    "name": "string",
    "description": "string",
    "ownerId": "uuid",
    "category": "string",
    "published": true,
    "downloadCount": 100,
    "metadata": {},
    "createdAt": 1234567890,
    "updatedAt": 1234567890
  }
}
```

**错误**
- `UNAUTHORIZED`: 未认证
- `FORBIDDEN`: 非应用所有者
- `NOT_FOUND`: 应用不存在
- `VALIDATION_ERROR`: 输入验证失败

---

### 9. 删除应用

**DELETE** `/applications/:id`

删除应用（仅所有者可操作）。

**请求头**
```
Authorization: Bearer <token>
```

**路径参数**
- `id`: 应用 ID

**响应**
```json
{
  "success": true,
  "data": {
    "message": "Application deleted successfully"
  }
}
```

**错误**
- `UNAUTHORIZED`: 未认证
- `FORBIDDEN`: 非应用所有者
- `NOT_FOUND`: 应用不存在

---

### 10. 获取用户的应用

**GET** `/users/me/applications`

获取当前用户创建的所有应用。

**请求头**
```
Authorization: Bearer <token>
```

**响应**
```json
{
  "success": true,
  "data": {
    "applications": [
      {
        "applicationId": "uuid",
        "name": "string",
        "description": "string",
        "ownerId": "uuid",
        "category": "string",
        "published": false,
        "downloadCount": 0,
        "metadata": {},
        "createdAt": 1234567890,
        "updatedAt": 1234567890
      }
    ]
  }
}
```

**错误**
- `UNAUTHORIZED`: 未认证

---

## 文件 API

### 11. 上传应用包

**POST** `/applications/:id/upload`

上传应用包文件（仅所有者可操作）。

**请求头**
```
Authorization: Bearer <token>
Content-Type: multipart/form-data
```

**路径参数**
- `id`: 应用 ID

**表单数据**
- `file`: 应用包文件（必需）
- `version`: 版本号（必需，如 "1.0.0"）
- `changelog`: 更新日志（可选）

**响应**
```json
{
  "success": true,
  "data": {
    "versionId": "uuid",
    "applicationId": "uuid",
    "version": "1.0.0",
    "changelog": "string",
    "filePath": "string",
    "fileSize": 1024,
    "publishedAt": 1234567890
  }
}
```

**错误**
- `UNAUTHORIZED`: 未认证
- `FORBIDDEN`: 非应用所有者
- `NOT_FOUND`: 应用不存在
- `VALIDATION_ERROR`: 文件验证失败
- `ALREADY_EXISTS`: 版本已存在

---

### 12. 下载应用包

**GET** `/applications/:id/download`

下载应用包文件。

**路径参数**
- `id`: 应用 ID

**查询参数**
- `version`: 版本号（可选，默认最新版本）

**响应**
- Content-Type: `application/octet-stream`
- Content-Disposition: `attachment; filename="..."`
- 文件二进制数据

**错误**
- `NOT_FOUND`: 应用或版本不存在

---

### 13. 获取版本列表

**GET** `/applications/:id/versions`

获取应用的所有版本。

**路径参数**
- `id`: 应用 ID

**响应**
```json
{
  "success": true,
  "data": {
    "versions": [
      {
        "versionId": "uuid",
        "version": "1.0.0",
        "changelog": "string",
        "fileSize": 1024,
        "publishedAt": 1234567890
      }
    ]
  }
}
```

**错误**
- `NOT_FOUND`: 应用不存在

---

## 使用示例

### JavaScript/TypeScript

```typescript
// 用户登录
const response = await fetch('http://localhost:3000/api/v1/users/login', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    email: 'user@example.com',
    password: 'password123'
  })
});

const { data } = await response.json();
const token = data.token;

// 获取应用列表
const appsResponse = await fetch('http://localhost:3000/api/v1/applications?page=1&limit=20', {
  headers: {
    'Authorization': `Bearer ${token}`
  }
});

const { data: appsData } = await appsResponse.json();
console.log(appsData.applications);
```

### cURL

```bash
# 用户登录
curl -X POST http://localhost:3000/api/v1/users/login \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"password123"}'

# 获取应用列表
curl http://localhost:3000/api/v1/applications \
  -H "Authorization: Bearer <your-token>"

# 上传应用包
curl -X POST http://localhost:3000/api/v1/applications/<app-id>/upload \
  -H "Authorization: Bearer <your-token>" \
  -F "file=@app.zip" \
  -F "version=1.0.0" \
  -F "changelog=Initial release"
```

## 相关文档

- [后端 API 设计](../backend/API_DESIGN.md)
- [应用市场系统](./APP_MARKETPLACE.md)
- [项目状态](./PROJECT_STATUS.md)
