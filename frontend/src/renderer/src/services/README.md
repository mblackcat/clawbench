# API 客户端服务

API 客户端服务提供与后端 API 通信的完整封装，包括认证管理、请求拦截和错误处理。

## 功能特性

- ✅ HTTP 客户端封装（GET, POST, PUT, DELETE）
- ✅ JWT 认证令牌管理（自动存储和附加到请求）
- ✅ 请求拦截器和错误处理
- ✅ 完整的 TypeScript 类型定义
- ✅ 文件上传和下载支持
- ✅ 自动重试和错误分类

## 使用方法

### 导入客户端

```typescript
import { apiClient } from '@/services/apiClient';
```

### 用户认证

#### 注册用户

```typescript
try {
  const user = await apiClient.register({
    username: 'testuser',
    email: 'test@example.com',
    password: 'securepassword123'
  });
  console.log('注册成功:', user);
} catch (error) {
  if (error instanceof ApiClientError) {
    console.error('注册失败:', error.message);
  }
}
```

#### 用户登录

```typescript
try {
  const response = await apiClient.login({
    email: 'test@example.com',
    password: 'securepassword123'
  });
  console.log('登录成功，令牌:', response.token);
  // 令牌会自动保存到 localStorage
} catch (error) {
  if (error instanceof ApiClientError) {
    if (error.isAuthError()) {
      console.error('登录失败: 用户名或密码错误');
    }
  }
}
```

#### 获取当前用户信息

```typescript
try {
  const user = await apiClient.getCurrentUser();
  console.log('当前用户:', user);
} catch (error) {
  if (error instanceof ApiClientError && error.isAuthError()) {
    console.error('未登录或令牌已过期');
  }
}
```

#### 用户注销

```typescript
await apiClient.logout();
console.log('已注销');
```

#### 检查登录状态

```typescript
if (apiClient.isLoggedIn()) {
  console.log('用户已登录');
} else {
  console.log('用户未登录');
}
```

### 应用管理

#### 创建应用

```typescript
try {
  const app = await apiClient.createApplication({
    name: '我的应用',
    description: '这是一个测试应用',
    version: '1.0.0',
    category: 'utility',
    metadata: {
      author: 'Test User',
      license: 'MIT'
    }
  });
  console.log('应用创建成功:', app);
} catch (error) {
  if (error instanceof ApiClientError) {
    if (error.isAuthError()) {
      console.error('需要登录才能创建应用');
    } else if (error.isValidationError()) {
      console.error('输入数据验证失败:', error.details);
    }
  }
}
```

#### 获取应用列表

```typescript
// 获取所有应用
const result = await apiClient.listApplications();
console.log('应用列表:', result.applications);
console.log('总数:', result.total);

// 带筛选条件
const filtered = await apiClient.listApplications({
  category: 'utility',
  search: '测试',
  limit: 10,
  offset: 0
});
```

#### 获取应用详情

```typescript
const app = await apiClient.getApplication('app-id-123');
console.log('应用详情:', app);
console.log('版本历史:', app.versions);
```

#### 更新应用

```typescript
try {
  const updated = await apiClient.updateApplication('app-id-123', {
    name: '更新后的名称',
    description: '更新后的描述'
  });
  console.log('应用更新成功:', updated);
} catch (error) {
  if (error instanceof ApiClientError && error.isPermissionError()) {
    console.error('只有应用所有者可以更新应用');
  }
}
```

#### 删除应用

```typescript
try {
  await apiClient.deleteApplication('app-id-123');
  console.log('应用删除成功');
} catch (error) {
  if (error instanceof ApiClientError && error.isPermissionError()) {
    console.error('只有应用所有者可以删除应用');
  }
}
```

#### 获取当前用户的应用

```typescript
const myApps = await apiClient.getUserApplications();
console.log('我的应用:', myApps);
```

### 文件操作

#### 上传应用包

```typescript
const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
const file = fileInput.files?.[0];

if (file) {
  try {
    const result = await apiClient.uploadApplication(
      'app-id-123',
      file,
      '1.0.1',
      '修复了一些 bug'
    );
    console.log('上传成功:', result);
    console.log('下载链接:', result.downloadUrl);
  } catch (error) {
    if (error instanceof ApiClientError) {
      if (error.code === 'INVALID_FILE_FORMAT') {
        console.error('文件格式不正确');
      }
    }
  }
}
```

#### 下载应用包

```typescript
try {
  // 下载最新版本
  const blob = await apiClient.downloadApplication('app-id-123');
  
  // 创建下载链接
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'app.zip';
  a.click();
  URL.revokeObjectURL(url);
  
  // 下载特定版本
  const oldVersion = await apiClient.downloadApplication('app-id-123', '1.0.0');
} catch (error) {
  console.error('下载失败:', error);
}
```

#### 获取版本列表

```typescript
const versions = await apiClient.getApplicationVersions('app-id-123');
console.log('版本列表:', versions.versions);
```

## 错误处理

API 客户端使用 `ApiClientError` 类来表示所有错误。该类提供了便捷的方法来识别错误类型：

```typescript
import { ApiClientError } from '@/services/apiClient';

try {
  await apiClient.someMethod();
} catch (error) {
  if (error instanceof ApiClientError) {
    // 检查错误类型
    if (error.isAuthError()) {
      console.error('认证错误 (401):', error.message);
      // 跳转到登录页面
    } else if (error.isPermissionError()) {
      console.error('权限错误 (403):', error.message);
      // 显示权限不足提示
    } else if (error.isValidationError()) {
      console.error('验证错误 (400):', error.message);
      // 显示表单验证错误
    } else if (error.isNetworkError()) {
      console.error('网络错误:', error.message);
      // 显示网络连接失败提示
    } else {
      console.error('其他错误:', error.message);
    }
    
    // 访问错误详情
    console.log('错误代码:', error.code);
    console.log('HTTP 状态码:', error.status);
    console.log('详细信息:', error.details);
  }
}
```

## 错误代码

### 认证错误 (401)
- `INVALID_CREDENTIALS`: 无效的登录凭证
- `TOKEN_EXPIRED`: 令牌已过期
- `INVALID_TOKEN`: 无效的令牌
- `AUTH_REQUIRED`: 需要认证

### 授权错误 (403)
- `PERMISSION_DENIED`: 权限不足
- `NOT_OWNER`: 非资源所有者

### 验证错误 (400)
- `VALIDATION_ERROR`: 验证失败
- `MISSING_FIELD`: 缺少必需字段
- `INVALID_TYPE`: 字段类型错误
- `INVALID_VALUE`: 字段值无效
- `INVALID_FILE_FORMAT`: 文件格式无效

### 资源错误
- `NOT_FOUND` (404): 资源不存在
- `ALREADY_EXISTS` (409): 资源已存在

### 服务器错误 (500)
- `DATABASE_ERROR`: 数据库错误
- `FILE_SYSTEM_ERROR`: 文件系统错误
- `INTERNAL_ERROR`: 内部服务器错误

### 网络错误
- `NETWORK_ERROR`: 网络连接失败

## 在 React 组件中使用

### 使用 useState 和 useEffect

```typescript
import { useState, useEffect } from 'react';
import { apiClient, ApiClientError } from '@/services/apiClient';
import type { Application } from '@/types/api';

function ApplicationList() {
  const [apps, setApps] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchApps() {
      try {
        const result = await apiClient.listApplications();
        setApps(result.applications);
      } catch (err) {
        if (err instanceof ApiClientError) {
          setError(err.message);
        }
      } finally {
        setLoading(false);
      }
    }

    fetchApps();
  }, []);

  if (loading) return <div>加载中...</div>;
  if (error) return <div>错误: {error}</div>;

  return (
    <div>
      {apps.map(app => (
        <div key={app.applicationId}>{app.name}</div>
      ))}
    </div>
  );
}
```

### 在 Zustand Store 中使用

```typescript
import { create } from 'zustand';
import { apiClient } from '@/services/apiClient';
import type { Application } from '@/types/api';

interface AppStore {
  applications: Application[];
  loading: boolean;
  fetchApplications: () => Promise<void>;
  createApplication: (data: CreateApplicationRequest) => Promise<void>;
}

export const useAppStore = create<AppStore>((set) => ({
  applications: [],
  loading: false,

  fetchApplications: async () => {
    set({ loading: true });
    try {
      const result = await apiClient.listApplications();
      set({ applications: result.applications });
    } finally {
      set({ loading: false });
    }
  },

  createApplication: async (data) => {
    const app = await apiClient.createApplication(data);
    set((state) => ({
      applications: [...state.applications, app as any]
    }));
  }
}));
```

## 配置

API 客户端的配置在 `apiClient.ts` 文件顶部：

```typescript
const API_BASE_URL = 'http://localhost:3000/api/v1';
const TOKEN_STORAGE_KEY = 'app_marketplace_token';
```

如果需要修改后端 API 地址或令牌存储键，请修改这些常量。

## 类型定义

所有 API 相关的类型定义都在 `src/renderer/src/types/api.ts` 文件中，包括：

- 请求和响应类型
- 用户、应用、版本等数据模型
- 错误代码枚举

## 注意事项

1. **认证令牌**: 登录后令牌会自动保存到 `localStorage`，并在后续请求中自动附加到 `Authorization` 头
2. **错误处理**: 所有 API 错误都会被转换为 `ApiClientError`，建议使用 try-catch 处理
3. **网络错误**: 网络连接失败会抛出 `NETWORK_ERROR` 错误
4. **文件上传**: 使用 `FormData` 格式上传文件，不需要手动设置 `Content-Type`
5. **文件下载**: 返回 `Blob` 对象，需要手动创建下载链接

## 测试

API 客户端包含完整的单元测试，位于 `__tests__/apiClient.test.ts`。测试覆盖：

- 令牌管理（登录、注销、令牌存储）
- 错误处理（认证错误、验证错误、网络错误）
- 应用 API（创建、列表、详情、更新、删除）
- 文件上传

运行测试（需要配置测试环境）：

```bash
npm test src/renderer/src/services/__tests__/apiClient.test.ts
```
