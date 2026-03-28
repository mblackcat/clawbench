/**
 * 应用管理器
 * 负责应用的安装、卸载、更新等生命周期管理
 */

import { apiClient, API_BASE_URL } from './apiClient';
import type { Application, ApplicationDetail, ApplicationType } from '../types/api';
import { localStorageManager } from './localStorageManager';

export interface InstalledApp extends Application {
  installedAt: number;
  installPath: string;
  pinned: boolean;
  pinnedOrder: number;
  hasUpdate?: boolean;
  localVersion?: string;
}

export interface UpdateInfo {
  applicationId: string;
  currentVersion: string;
  latestVersion: string;
  hasUpdate: boolean;
}

class ApplicationManager {
  private appsCache: Application[] | null = null;
  private cacheTimestamp: number = 0;
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5分钟缓存

  /**
   * 从服务端获取应用列表（带缓存）
   */
  async fetchApplications(forceRefresh: boolean = false, type?: ApplicationType): Promise<Application[]> {
    const now = Date.now();
    if (!forceRefresh && !type && this.appsCache && now - this.cacheTimestamp < this.CACHE_TTL) {
      return this.appsCache;
    }

    const response = await apiClient.listApplications(type ? { type } : undefined);
    if (!type) {
      this.appsCache = response.applications;
      this.cacheTimestamp = now;
    }
    return response.applications;
  }

  /**
   * 获取应用详情
   */
  async fetchApplicationDetail(applicationId: string): Promise<ApplicationDetail> {
    return apiClient.getApplication(applicationId);
  }

  /**
   * 获取用户开发的应用
   */
  async fetchUserApplications(): Promise<Application[]> {
    return apiClient.getUserApplications();
  }

  /**
   * 创建应用
   */
  async createApplication(data: {
    name: string;
    description: string;
    version: string;
    category: string;
    type?: ApplicationType;
    metadata?: Record<string, any>;
  }): Promise<Application> {
    const response = await apiClient.createApplication(data);
    this.clearCache();
    return response as any;
  }

  /**
   * 更新应用
   */
  async updateApplication(
    applicationId: string,
    data: {
      name?: string;
      description?: string;
      metadata?: Record<string, any>;
    }
  ): Promise<Application> {
    const response = await apiClient.updateApplication(applicationId, data);
    this.clearCache();
    return response as any;
  }

  /**
   * 删除应用
   */
  async deleteApplication(applicationId: string): Promise<boolean> {
    const response = await apiClient.deleteApplication(applicationId);
    this.clearCache();
    return response.success;
  }

  /**
   * 上传应用包
   */
  async uploadApplication(
    applicationId: string,
    file: File,
    version: string,
    changelog: string
  ): Promise<void> {
    await apiClient.uploadApplication(applicationId, file, version, changelog);
    this.clearCache();
  }

  /**
   * 安装应用到本地（通过 IPC 在 main process 中完成下载、解压、安装）
   */
  async installApplication(applicationId: string): Promise<boolean> {
    try {
      const downloadUrl = `${API_BASE_URL}/applications/${encodeURIComponent(applicationId)}/download`;
      const token = apiClient.getToken() || undefined;

      const result = await window.api.subapp.installFromMarket(applicationId, downloadUrl, token);

      if (!result.success) {
        throw new Error('安装失败');
      }

      return true;
    } catch (error) {
      console.error('Failed to install application:', error);
      throw error;
    }
  }

  /**
   * 卸载应用（通过 IPC 在 main process 中删除）
   */
  async uninstallApplication(applicationId: string): Promise<boolean> {
    try {
      const result = await window.api.subapp.uninstall(applicationId);
      if (!result.success) {
        throw new Error(result.error || '卸载失败');
      }
      return true;
    } catch (error) {
      console.error('Failed to uninstall application:', error);
      throw error;
    }
  }

  /**
   * 更新应用
   */
  async updateApplication2(applicationId: string): Promise<boolean> {
    try {
      // 1. 先卸载旧版本
      await this.uninstallApplication(applicationId);

      // 2. 安装新版本
      await this.installApplication(applicationId);

      return true;
    } catch (error) {
      console.error('Failed to update application:', error);
      throw error;
    }
  }

  /**
   * 检查所有已安装应用的更新
   */
  async checkForUpdates(): Promise<UpdateInfo[]> {
    const installedApps = localStorageManager.getInstalledApps();
    const updateInfos: UpdateInfo[] = [];

    for (const installedApp of installedApps) {
      try {
        const appDetail = await this.fetchApplicationDetail(installedApp.applicationId);
        const hasUpdate = this.compareVersions(installedApp.localVersion || '', appDetail.version) < 0;
        
        updateInfos.push({
          applicationId: installedApp.applicationId,
          currentVersion: installedApp.localVersion || '',
          latestVersion: appDetail.version,
          hasUpdate,
        });

        // 更新本地缓存的更新标记
        if (hasUpdate) {
          installedApp.hasUpdate = true;
          localStorageManager.saveInstalledApp(installedApp);
        }
      } catch (error) {
        console.error(`Failed to check update for ${installedApp.applicationId}:`, error);
      }
    }

    return updateInfos;
  }

  /**
   * 获取已安装应用列表
   */
  getLocalApplications(): InstalledApp[] {
    return localStorageManager.getInstalledApps();
  }

  /**
   * 获取置顶应用列表
   */
  getPinnedApplications(): InstalledApp[] {
    const apps = localStorageManager.getInstalledApps();
    return apps
      .filter(app => app.pinned)
      .sort((a, b) => a.pinnedOrder - b.pinnedOrder);
  }

  /**
   * 获取非置顶应用列表
   */
  getUnpinnedApplications(): InstalledApp[] {
    const apps = localStorageManager.getInstalledApps();
    return apps.filter(app => !app.pinned);
  }

  /**
   * 置顶应用
   */
  pinApplication(applicationId: string): boolean {
    const app = localStorageManager.getInstalledApp(applicationId);
    if (!app) return false;

    const pinnedApps = this.getPinnedApplications();
    app.pinned = true;
    app.pinnedOrder = pinnedApps.length;
    
    localStorageManager.saveInstalledApp(app);
    return true;
  }

  /**
   * 取消置顶
   */
  unpinApplication(applicationId: string): boolean {
    const app = localStorageManager.getInstalledApp(applicationId);
    if (!app) return false;

    app.pinned = false;
    app.pinnedOrder = 0;
    
    localStorageManager.saveInstalledApp(app);
    
    // 重新排序其他置顶应用
    this.reorderPinnedApps();
    return true;
  }

  /**
   * 重新排序置顶应用
   */
  reorderPinnedApps(newOrder?: string[]): void {
    const pinnedApps = this.getPinnedApplications();
    
    if (newOrder) {
      // 按照新顺序更新
      newOrder.forEach((appId, index) => {
        const app = localStorageManager.getInstalledApp(appId);
        if (app && app.pinned) {
          app.pinnedOrder = index;
          localStorageManager.saveInstalledApp(app);
        }
      });
    } else {
      // 重新编号
      pinnedApps.forEach((app, index) => {
        app.pinnedOrder = index;
        localStorageManager.saveInstalledApp(app);
      });
    }
  }

  /**
   * 清除缓存
   */
  clearCache(): void {
    this.appsCache = null;
    this.cacheTimestamp = 0;
  }

  /**
   * 比较版本号（简单实现）
   */
  private compareVersions(v1: string, v2: string): number {
    const parts1 = v1.split('.').map(Number);
    const parts2 = v2.split('.').map(Number);
    
    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
      const p1 = parts1[i] || 0;
      const p2 = parts2[i] || 0;
      if (p1 < p2) return -1;
      if (p1 > p2) return 1;
    }
    
    return 0;
  }

}

export const applicationManager = new ApplicationManager();
export default applicationManager;
