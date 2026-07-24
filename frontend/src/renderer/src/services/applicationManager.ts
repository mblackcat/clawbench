/**
 * 应用管理器
 * 负责应用的安装、卸载、更新等生命周期管理
 */

import { apiClient, API_BASE_URL } from './apiClient';
import type { Application, ApplicationDetail, ApplicationType } from '../types/api';
import { localStorageManager } from './localStorageManager';

/**
 * 已安装应用的最小结构（用于版本检查）。与各处本地定义的 SubAppInfo 结构兼容。
 */
export interface InstalledAppInfoLike {
  manifest: {
    id?: string
    version?: string
  }
}

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
   * 下架应用（取消发布）。成功时后端返回更新后的应用对象；
   * 失败会抛出 ApiClientError（非 2xx 响应），由调用方 catch。
   */
  async unpublishApplication(applicationId: string): Promise<boolean> {
    await apiClient.unpublishApplication(applicationId);
    this.clearCache();
    return true;
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
   * 安装 AI 技能到指定位置（四种方式之一）
   */
  async installSkillFromMarket(
    applicationId: string,
    opts: {
      mode: import('../types/skill').SkillInstallMode
      tools: import('../types/skill').SkillTool[]
      workspacePath?: string
    }
  ): Promise<{ success: boolean; installedTo: string[]; error?: string }> {
    const downloadUrl = `${API_BASE_URL}/applications/${encodeURIComponent(applicationId)}/download`;
    const token = apiClient.getToken() || undefined;
    return window.api.subapp.installSkillFromMarket(applicationId, downloadUrl, opts, token);
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
   * 更新已安装应用（非破坏性合并：新版本文件覆盖同名旧文件，本地生成的文件保留）
   * 通过 IPC 在 main process 中完成下载、解压、合并安装。
   * opts.force = true 时执行完整替换（重置为线上版本）。
   */
  async updateInstalledApp(
    applicationId: string,
    opts?: { force?: boolean }
  ): Promise<boolean> {
    try {
      const downloadUrl = `${API_BASE_URL}/applications/${encodeURIComponent(applicationId)}/download`;
      const token = apiClient.getToken() || undefined;

      const result = await window.api.subapp.updateFromMarket(
        applicationId,
        downloadUrl,
        token,
        opts
      );

      if (!result.success) {
        throw new Error(opts?.force ? '重置失败' : '更新失败');
      }

      return true;
    } catch (error) {
      console.error('Failed to update application:', error);
      throw error;
    }
  }

  /** 用市场包完整替换本地安装（重置为线上版本，丢弃本地改动）。 */
  async resetInstalledApp(applicationId: string): Promise<boolean> {
    return this.updateInstalledApp(applicationId, { force: true });
  }

  /**
   * 更新应用（遗留入口，等价于 updateInstalledApp）
   * 保留以兼容现有调用点；行为已改为非破坏性合并。
   */
  async updateApplication2(applicationId: string): Promise<boolean> {
    return this.updateInstalledApp(applicationId);
  }

  /**
   * 检查所有已安装应用的更新
   *
   * 注意：此方法基于 localStorage 中的 InstalledApp 记录。市场安装流程并不会
   * 写入 localStorage，因此对市场安装的应用通常返回空列表。新代码请改用
   * {@link checkInstalledAppUpdates}，它直接基于磁盘上扫描到的 manifest。
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
   * 基于磁盘上实际扫描到的已安装应用检查更新。
   *
   * 对每个 appInfo，读取 manifest.id 作为市场 applicationId、manifest.version 作为
   * 本地版本号，拉取市场详情并比对版本。市场不存在的应用（如本地草稿）会 404，
   * 静默跳过。返回以本地 manifest.id 为 key 的 Map。
   */
  async checkInstalledAppUpdates(appInfos: InstalledAppInfoLike[]): Promise<Map<string, UpdateInfo>> {
    const result = new Map<string, UpdateInfo>();

    for (const info of appInfos) {
      const appId = info.manifest.id;
      const localVersion = info.manifest.version || '';
      if (!appId) continue;

      try {
        const appDetail = await this.fetchApplicationDetail(appId);
        const hasUpdate = this.compareVersions(localVersion, appDetail.version) < 0;
        result.set(appId, {
          applicationId: appId,
          currentVersion: localVersion,
          latestVersion: appDetail.version,
          hasUpdate,
        });
      } catch (error) {
        // 市场不存在该应用（本地草稿/用户自建）—— 静默跳过，不报错
        const msg = error instanceof Error ? error.message : String(error);
        if (!/404|not found/i.test(msg)) {
          console.error(`Failed to check update for ${appId}:`, error);
        }
      }
    }

    return result;
  }

  /**
   * 治愈本地 manifest 的 published 标记（以服务端为准）。
   *
   * 旧版发布流程在发布成功后未回写 published:true，导致部分已发布应用的本地
   * manifest 仍残留 published:false / 缺字段（脏数据）。此处对凡服务端存在同名
   * 应用、但本地 manifest.published !== true 的条目，回写为 true，使本地标记与
   * 服务端一致，同时修复离线 / 本地模式下的显示。
   *
   * 幂等：仅在 !== true 时写入，写后即 true，不会重复触发。返回治愈数量，调用方
   * 可据此决定是否需要重新 fetchApps() 刷新 UI。写盘失败不影响显示（服务端为准），
   * 仅告警。
   */
  async reconcilePublishedFlags(
    appInfos: { id: string; manifest: { name: string; published?: boolean } }[],
    publishedAppNames: Set<string>
  ): Promise<number> {
    let healed = 0;
    for (const info of appInfos) {
      const { id, manifest } = info;
      if (manifest.published === true) continue;
      if (!publishedAppNames.has(manifest.name)) continue;
      try {
        await window.api.developer.updateApp(id, { published: true });
        healed++;
      } catch (e) {
        console.warn(`Failed to reconcile published flag for ${id}:`, e);
      }
    }
    return healed;
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
