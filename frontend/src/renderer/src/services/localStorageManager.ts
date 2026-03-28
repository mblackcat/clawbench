/**
 * 本地存储管理器
 * 负责已安装应用信息、置顶配置等的本地持久化
 */

import type { InstalledApp } from './applicationManager';

const STORAGE_KEYS = {
  INSTALLED_APPS: 'clawbench_installed_apps',
  INSTALLATION_DIR: 'clawbench_installation_dir',
  LOGIN_METHOD: 'clawbench_login_method',
  SAVED_CREDENTIALS: 'clawbench_saved_credentials',
  SIDEBAR_COLLAPSED: 'clawbench_sidebar_collapsed',
} as const;

const CREDENTIALS_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

class LocalStorageManager {
  /**
   * 保存已安装应用信息
   */
  saveInstalledApp(app: InstalledApp): boolean {
    try {
      const apps = this.getInstalledApps();
      const index = apps.findIndex(a => a.applicationId === app.applicationId);
      
      if (index >= 0) {
        apps[index] = app;
      } else {
        apps.push(app);
      }
      
      localStorage.setItem(STORAGE_KEYS.INSTALLED_APPS, JSON.stringify(apps));
      return true;
    } catch (error) {
      console.error('Failed to save installed app:', error);
      return false;
    }
  }

  /**
   * 移除已安装应用信息
   */
  removeInstalledApp(applicationId: string): boolean {
    try {
      const apps = this.getInstalledApps();
      const filtered = apps.filter(a => a.applicationId !== applicationId);
      
      localStorage.setItem(STORAGE_KEYS.INSTALLED_APPS, JSON.stringify(filtered));
      return true;
    } catch (error) {
      console.error('Failed to remove installed app:', error);
      return false;
    }
  }

  /**
   * 获取已安装应用列表
   */
  getInstalledApps(): InstalledApp[] {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.INSTALLED_APPS);
      if (!data) return [];
      
      return JSON.parse(data) as InstalledApp[];
    } catch (error) {
      console.error('Failed to get installed apps:', error);
      return [];
    }
  }

  /**
   * 获取单个已安装应用信息
   */
  getInstalledApp(applicationId: string): InstalledApp | null {
    const apps = this.getInstalledApps();
    return apps.find(a => a.applicationId === applicationId) || null;
  }

  /**
   * 检查应用是否已安装
   */
  isAppInstalled(applicationId: string): boolean {
    return this.getInstalledApp(applicationId) !== null;
  }

  /**
   * 保存安装目录配置
   */
  saveInstallationDirectory(path: string): boolean {
    try {
      localStorage.setItem(STORAGE_KEYS.INSTALLATION_DIR, path);
      return true;
    } catch (error) {
      console.error('Failed to save installation directory:', error);
      return false;
    }
  }

  /**
   * 获取安装目录配置
   */
  getInstallationDirectory(): string | null {
    try {
      return localStorage.getItem(STORAGE_KEYS.INSTALLATION_DIR);
    } catch (error) {
      console.error('Failed to get installation directory:', error);
      return null;
    }
  }

  /**
   * 获取置顶应用ID列表
   */
  getPinnedAppIds(): string[] {
    const apps = this.getInstalledApps();
    return apps
      .filter(app => app.pinned)
      .sort((a, b) => a.pinnedOrder - b.pinnedOrder)
      .map(app => app.applicationId);
  }

  /**
   * 保存置顶应用列表（用于批量更新排序）
   */
  savePinnedApps(appIds: string[]): boolean {
    try {
      const apps = this.getInstalledApps();
      
      // 先取消所有置顶
      apps.forEach(app => {
        app.pinned = false;
        app.pinnedOrder = 0;
      });
      
      // 设置新的置顶列表
      appIds.forEach((appId, index) => {
        const app = apps.find(a => a.applicationId === appId);
        if (app) {
          app.pinned = true;
          app.pinnedOrder = index;
        }
      });
      
      localStorage.setItem(STORAGE_KEYS.INSTALLED_APPS, JSON.stringify(apps));
      return true;
    } catch (error) {
      console.error('Failed to save pinned apps:', error);
      return false;
    }
  }

  // ============ 登录偏好 ============

  /**
   * 保存上次登录方式
   */
  saveLoginMethod(method: 'feishu' | 'password'): void {
    try {
      localStorage.setItem(STORAGE_KEYS.LOGIN_METHOD, method);
    } catch (error) {
      console.error('Failed to save login method:', error);
    }
  }

  /**
   * 获取上次登录方式
   */
  getLoginMethod(): 'feishu' | 'password' | null {
    try {
      const method = localStorage.getItem(STORAGE_KEYS.LOGIN_METHOD);
      if (method === 'feishu' || method === 'password') return method;
      return null;
    } catch {
      return null;
    }
  }

  /**
   * 保存账号密码（带 30 天有效期，base64 编码）
   */
  saveCredentials(username: string, password: string): void {
    try {
      const data = JSON.stringify({
        username,
        password: btoa(password),
        savedAt: Date.now(),
      });
      localStorage.setItem(STORAGE_KEYS.SAVED_CREDENTIALS, data);
    } catch (error) {
      console.error('Failed to save credentials:', error);
    }
  }

  /**
   * 获取已保存的账号密码（过期则自动清除）
   */
  getSavedCredentials(): { username: string; password: string } | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.SAVED_CREDENTIALS);
      if (!raw) return null;

      const data = JSON.parse(raw);
      if (Date.now() - data.savedAt > CREDENTIALS_TTL_MS) {
        localStorage.removeItem(STORAGE_KEYS.SAVED_CREDENTIALS);
        return null;
      }

      return { username: data.username, password: atob(data.password) };
    } catch {
      localStorage.removeItem(STORAGE_KEYS.SAVED_CREDENTIALS);
      return null;
    }
  }

  /**
   * 清除已保存的账号密码
   */
  clearCredentials(): void {
    try {
      localStorage.removeItem(STORAGE_KEYS.SAVED_CREDENTIALS);
    } catch { /* ignore */ }
  }

  // ============ 侧边栏状态 ============

  /**
   * 保存侧边栏展开/收起状态
   */
  saveSidebarCollapsed(collapsed: boolean): void {
    try {
      localStorage.setItem(STORAGE_KEYS.SIDEBAR_COLLAPSED, JSON.stringify(collapsed));
    } catch (error) {
      console.error('Failed to save sidebar state:', error);
    }
  }

  /**
   * 获取侧边栏展开/收起状态
   */
  getSidebarCollapsed(): boolean {
    try {
      const value = localStorage.getItem(STORAGE_KEYS.SIDEBAR_COLLAPSED);
      if (value === null) return false;
      return JSON.parse(value) === true;
    } catch {
      return false;
    }
  }

  /**
   * 清除所有数据
   */
  clearAll(): void {
    try {
      localStorage.removeItem(STORAGE_KEYS.INSTALLED_APPS);
      localStorage.removeItem(STORAGE_KEYS.INSTALLATION_DIR);
      localStorage.removeItem(STORAGE_KEYS.LOGIN_METHOD);
      localStorage.removeItem(STORAGE_KEYS.SAVED_CREDENTIALS);
      localStorage.removeItem(STORAGE_KEYS.SIDEBAR_COLLAPSED);
    } catch (error) {
      console.error('Failed to clear storage:', error);
    }
  }
}

export const localStorageManager = new LocalStorageManager();
export default localStorageManager;
