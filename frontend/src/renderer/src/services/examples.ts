/**
 * API 客户端使用示例
 * 这个文件展示了如何在实际应用中使用 API 客户端
 */

import { apiClient, ApiClientError } from './apiClient';
import type {
  RegisterRequest,
  LoginRequest,
  CreateApplicationRequest,
  UpdateApplicationRequest,
} from '../types/api';

// ============ 用户认证示例 ============

/**
 * 用户注册示例
 */
export async function registerExample() {
  const registerData: RegisterRequest = {
    username: 'newuser',
    email: 'newuser@example.com',
    password: 'securePassword123',
  };

  try {
    const user = await apiClient.register(registerData);
    console.log('注册成功:', user);
    return user;
  } catch (error) {
    if (error instanceof ApiClientError) {
      if (error.isValidationError()) {
        console.error('注册信息验证失败:', error.message);
      } else if (error.code === 'ALREADY_EXISTS') {
        console.error('用户已存在');
      }
    }
    throw error;
  }
}

/**
 * 用户登录示例
 */
export async function loginExample() {
  const loginData: LoginRequest = {
    email: 'user@example.com',
    password: 'password123',
  };

  try {
    const response = await apiClient.login(loginData);
    console.log('登录成功，令牌已保存');
    console.log('用户ID:', response.userId);
    console.log('令牌过期时间:', new Date(response.expiresAt));
    return response;
  } catch (error) {
    if (error instanceof ApiClientError) {
      if (error.isAuthError()) {
        console.error('登录失败: 用户名或密码错误');
      }
    }
    throw error;
  }
}

/**
 * 获取当前用户信息示例
 */
export async function getCurrentUserExample() {
  try {
    const user = await apiClient.getCurrentUser();
    console.log('当前用户:', user);
    return user;
  } catch (error) {
    if (error instanceof ApiClientError && error.isAuthError()) {
      console.error('未登录或令牌已过期，请重新登录');
      // 可以在这里跳转到登录页面
    }
    throw error;
  }
}

/**
 * 用户注销示例
 */
export async function logoutExample() {
  try {
    await apiClient.logout();
    console.log('注销成功');
  } catch (error) {
    console.error('注销失败:', error);
  }
}

// ============ 应用管理示例 ============

/**
 * 创建应用示例
 */
export async function createApplicationExample() {
  const appData: CreateApplicationRequest = {
    name: '我的第一个应用',
    description: '这是一个测试应用，用于演示应用市场功能',
    version: '1.0.0',
    category: 'utility',
    metadata: {
      author: 'Test User',
      license: 'MIT',
      homepage: 'https://example.com',
    },
  };

  try {
    const app = await apiClient.createApplication(appData);
    console.log('应用创建成功:', app);
    return app;
  } catch (error) {
    if (error instanceof ApiClientError) {
      if (error.isAuthError()) {
        console.error('需要登录才能创建应用');
      } else if (error.isValidationError()) {
        console.error('应用信息验证失败:', error.details);
      }
    }
    throw error;
  }
}

/**
 * 获取应用列表示例
 */
export async function listApplicationsExample() {
  try {
    // 获取所有应用
    const allApps = await apiClient.listApplications();
    console.log('所有应用:', allApps.applications);
    console.log('总数:', allApps.total);

    // 带筛选条件
    const filteredApps = await apiClient.listApplications({
      category: 'utility',
      search: '测试',
      limit: 10,
      offset: 0,
    });
    console.log('筛选后的应用:', filteredApps.applications);

    return allApps;
  } catch (error) {
    console.error('获取应用列表失败:', error);
    throw error;
  }
}

/**
 * 获取应用详情示例
 */
export async function getApplicationExample(applicationId: string) {
  try {
    const app = await apiClient.getApplication(applicationId);
    console.log('应用详情:', app);
    console.log('版本历史:', app.versions);
    return app;
  } catch (error) {
    if (error instanceof ApiClientError && error.code === 'NOT_FOUND') {
      console.error('应用不存在');
    }
    throw error;
  }
}

/**
 * 更新应用示例
 */
export async function updateApplicationExample(applicationId: string) {
  const updateData: UpdateApplicationRequest = {
    name: '更新后的应用名称',
    description: '更新后的应用描述',
    metadata: {
      version: '1.0.1',
      changelog: '修复了一些 bug',
    },
  };

  try {
    const updated = await apiClient.updateApplication(applicationId, updateData);
    console.log('应用更新成功:', updated);
    return updated;
  } catch (error) {
    if (error instanceof ApiClientError) {
      if (error.isPermissionError()) {
        console.error('只有应用所有者可以更新应用');
      } else if (error.code === 'NOT_FOUND') {
        console.error('应用不存在');
      }
    }
    throw error;
  }
}

/**
 * 删除应用示例
 */
export async function deleteApplicationExample(applicationId: string) {
  try {
    await apiClient.deleteApplication(applicationId);
    console.log('应用删除成功');
  } catch (error) {
    if (error instanceof ApiClientError) {
      if (error.isPermissionError()) {
        console.error('只有应用所有者可以删除应用');
      } else if (error.code === 'NOT_FOUND') {
        console.error('应用不存在');
      }
    }
    throw error;
  }
}

/**
 * 获取当前用户的应用示例
 */
export async function getUserApplicationsExample() {
  try {
    const myApps = await apiClient.getUserApplications();
    console.log('我的应用:', myApps);
    return myApps;
  } catch (error) {
    if (error instanceof ApiClientError && error.isAuthError()) {
      console.error('需要登录才能查看我的应用');
    }
    throw error;
  }
}

// ============ 文件操作示例 ============

/**
 * 上传应用包示例
 */
export async function uploadApplicationExample(
  applicationId: string,
  file: File
) {
  try {
    const result = await apiClient.uploadApplication(
      applicationId,
      file,
      '1.0.1',
      '修复了一些 bug，提升了性能'
    );
    console.log('上传成功:', result);
    console.log('文件大小:', result.fileSize, 'bytes');
    console.log('下载链接:', result.downloadUrl);
    return result;
  } catch (error) {
    if (error instanceof ApiClientError) {
      if (error.code === 'INVALID_FILE_FORMAT') {
        console.error('文件格式不正确，请上传 ZIP 格式的应用包');
      } else if (error.isPermissionError()) {
        console.error('只有应用所有者可以上传应用包');
      }
    }
    throw error;
  }
}

/**
 * 下载应用包示例
 */
export async function downloadApplicationExample(
  applicationId: string,
  version?: string
) {
  try {
    const blob = await apiClient.downloadApplication(applicationId, version);
    
    // 创建下载链接
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `app-${applicationId}-${version || 'latest'}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    console.log('下载成功');
  } catch (error) {
    if (error instanceof ApiClientError && error.code === 'NOT_FOUND') {
      console.error('应用或版本不存在');
    }
    throw error;
  }
}

/**
 * 获取版本列表示例
 */
export async function getApplicationVersionsExample(applicationId: string) {
  try {
    const versions = await apiClient.getApplicationVersions(applicationId);
    console.log('版本列表:', versions.versions);
    
    // 显示每个版本的信息
    versions.versions.forEach((v) => {
      console.log(`版本 ${v.version}:`);
      console.log(`  发布时间: ${new Date(v.publishedAt).toLocaleString()}`);
      console.log(`  文件大小: ${v.fileSize} bytes`);
      console.log(`  更新日志: ${v.changelog}`);
    });
    
    return versions;
  } catch (error) {
    console.error('获取版本列表失败:', error);
    throw error;
  }
}

// ============ 完整流程示例 ============

/**
 * 完整的应用发布流程示例
 */
export async function completePublishFlowExample(file: File) {
  try {
    // 1. 检查登录状态
    if (!apiClient.isLoggedIn()) {
      console.log('未登录，开始登录...');
      await loginExample();
    }

    // 2. 创建应用
    console.log('创建应用...');
    const app = await createApplicationExample();

    // 3. 上传应用包
    console.log('上传应用包...');
    const uploadResult = await uploadApplicationExample(app.applicationId, file);

    // 4. 获取应用详情确认
    console.log('确认应用信息...');
    const appDetail = await getApplicationExample(app.applicationId);

    console.log('应用发布完成！');
    console.log('应用ID:', appDetail.applicationId);
    console.log('应用名称:', appDetail.name);
    console.log('已发布:', appDetail.published);
    console.log('下载链接:', uploadResult.downloadUrl);

    return appDetail;
  } catch (error) {
    console.error('应用发布流程失败:', error);
    throw error;
  }
}

/**
 * 完整的应用安装流程示例
 */
export async function completeInstallFlowExample(applicationId: string) {
  try {
    // 1. 获取应用详情
    console.log('获取应用信息...');
    const app = await getApplicationExample(applicationId);

    // 2. 检查应用是否已发布
    if (!app.published) {
      throw new Error('应用尚未发布');
    }

    // 3. 获取版本列表
    console.log('获取版本列表...');
    const versions = await getApplicationVersionsExample(applicationId);

    // 4. 下载最新版本
    console.log('下载应用包...');
    await downloadApplicationExample(applicationId);

    console.log('应用安装完成！');
    return app;
  } catch (error) {
    console.error('应用安装流程失败:', error);
    throw error;
  }
}
