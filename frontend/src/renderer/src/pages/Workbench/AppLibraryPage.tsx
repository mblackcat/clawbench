/**
 * 发现页面（原应用中心）
 * 混合市场：应用 / AI 技能 / 提示词 三类 Tab
 * 卡片按状态显示 Owner/Installed/Update/Reset/Install 操作，点击打开 Drawer。
 * 安装状态以磁盘扫描为准（manifest.id 优先，其次名称），版本比对得出
 * 待更新（本地 < 线上）/ 重置为线上（本地 > 线上）。
 */

import React, { useEffect, useState, useCallback } from 'react';
import { Typography, Empty, Spin, Tag, Input, Tooltip, theme, Button, App, Alert, Tabs, Drawer, Descriptions, Space } from 'antd';
import {
  SearchOutlined,
  PlusOutlined,
  SnippetsOutlined,
  ArrowLeftOutlined,
  CheckCircleOutlined,
  DownloadOutlined,
  SyncOutlined,
  CrownOutlined,
  CloudDownloadOutlined,
  MoreOutlined
} from '@ant-design/icons';
import { useNavigate, useLocation } from 'react-router-dom';
import { applicationManager } from '../../services/applicationManager';
import { localStorageManager } from '../../services/localStorageManager';
import type { Application, ApplicationType, ApplicationDetail } from '../../types/api';
import { useSubAppStore } from '../../stores/useSubAppStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { useWorkspaceStore } from '../../stores/useWorkspaceStore';
import { useSettingsStore } from '../../stores/useSettingsStore';
import CreateTypeModal from '../../components/CreateTypeModal';
import SkillInstallModal from '../../components/SkillInstallModal';
import { AppVersionTag } from '../../components/AppStatusTag';
import { AppIcon } from '../../components/AppIcon';
import { FolderCard } from '../../components/FolderCard';
import {
  resolveDiscoverStatus,
  discoverStatusLabelKey,
  isBuiltinAppId,
  type DiscoverCardStatus
} from '../../utils/app-status';
import type { SkillInstallMode, SkillTool } from '../../types/skill';
import { useT } from '../../i18n';

const { Title, Text } = Typography;
const { Search } = Input;

/** Owner (not installed locally) keeps OSS's crown entry; otherwise local-vs-online status. */
type AppStatus = 'owner' | DiscoverCardStatus;

const SMALL_TAG_STYLE: React.CSSProperties = {
  margin: 0,
  fontSize: 10,
  lineHeight: '16px',
  height: 18,
  padding: '0 5px'
};

const AppLibraryPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { token } = theme.useToken();
  const { message, modal } = App.useApp();
  const t = useT();
  // Back button target. Default to 收藏栏 so direct URL entry into 发现
  // doesn't strand the user with navigate(-1) → blank page.
  const backTarget = (location.state as { from?: string } | null)?.from || '/workbench/installed';
  const [loading, setLoading] = useState(true);
  const [allApps, setAllApps] = useState<Application[]>([]);
  const [filteredApps, setFilteredApps] = useState<Application[]>([]);
  const [searchText, setSearchText] = useState('');
  const [activeTab, setActiveTab] = useState<ApplicationType>('app');
  const [installing, setInstalling] = useState<Set<string>>(new Set());
  const [createModalOpen, setCreateModalOpen] = useState(false);
  /** Local on-disk version keyed by manifest id and by name (market match: id first, then name). */
  const [localVersionByKey, setLocalVersionByKey] = useState<{
    byId: Map<string, string>;
    byName: Map<string, string>;
  }>({ byId: new Map(), byName: new Map() });
  const pinnedApps = useSettingsStore((state) => state.pinnedApps);

  // Drawer state
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerApp, setDrawerApp] = useState<Application | null>(null);
  const [drawerDetail, setDrawerDetail] = useState<ApplicationDetail | null>(null);
  const [drawerLoading, setDrawerLoading] = useState(false);

  // AI-skill install: choose placement (4 modes) before download
  const [skillInstallOpen, setSkillInstallOpen] = useState(false);
  const [skillInstalling, setSkillInstalling] = useState(false);
  const [skillInstallApp, setSkillInstallApp] = useState<Application | null>(null);
  const activeWorkspace = useWorkspaceStore((s) => s.activeWorkspace);

  const fetchApps = useSubAppStore((state) => state.fetchApps);
  const appInfos = useSubAppStore((state) => state.appInfos);
  const isLocalMode = useAuthStore((state) => state.isLocalMode);
  const user = useAuthStore((state) => state.user);

  useEffect(() => {
    loadApps();
  }, [activeTab]);

  useEffect(() => {
    filterApps();
  }, [searchText, allApps]);

  const loadApps = async () => {
    setLoading(true);
    try {
      await fetchApps();
      // Installed-by-disk detection: read fresh manifests after fetchApps
      // (market installs never populate localStorage).
      const byId = new Map<string, string>();
      const byName = new Map<string, string>();
      for (const info of useSubAppStore.getState().appInfos) {
        if (info.source !== 'user') continue;
        const v = info.manifest.version || '';
        if (info.manifest.id) byId.set(info.manifest.id, v);
        if (info.manifest.name && !byName.has(info.manifest.name)) byName.set(info.manifest.name, v);
      }
      setLocalVersionByKey({ byId, byName });

      if (!isLocalMode) {
        // forceRefresh=true bypasses the 5-min cache, so switching to the
        // discovery page always re-fetches the latest marketplace list.
        const publishedApps = await applicationManager.fetchApplications(true, activeTab);
        setAllApps(publishedApps);
        setFilteredApps(publishedApps);
      }
    } catch (error) {
      console.error('Failed to load apps:', error);
      message.error(t('discover.loadFailed'));
    } finally {
      setLoading(false);
    }
  };

  const filterApps = () => {
    if (!searchText.trim()) {
      setFilteredApps(allApps);
      return;
    }

    const text = searchText.toLowerCase();
    const filtered = allApps.filter(
      app =>
        app.name.toLowerCase().includes(text) ||
        (app.description && app.description.toLowerCase().includes(text)) ||
        (app.category && app.category.toLowerCase().includes(text))
    );
    setFilteredApps(filtered);
  };

  const isOwner = useCallback(
    (app: Application): boolean => {
      const currentUserId = user?.id;
      return !!(currentUserId && app.ownerId === currentUserId);
    },
    [user]
  );

  /** Local version on disk: match by manifest id (= applicationId) first, then by name. */
  const getLocalVersion = useCallback(
    (app: Application): string | undefined => {
      if (localVersionByKey.byId.has(app.applicationId)) {
        return localVersionByKey.byId.get(app.applicationId) || undefined;
      }
      if (localVersionByKey.byName.has(app.name)) {
        return localVersionByKey.byName.get(app.name) || undefined;
      }
      return localStorageManager.getInstalledApp(app.applicationId)?.localVersion || undefined;
    },
    [localVersionByKey]
  );

  const isAppInstalled = useCallback(
    (app: Application): boolean =>
      localVersionByKey.byId.has(app.applicationId) ||
      localVersionByKey.byName.has(app.name) ||
      localStorageManager.isAppInstalled(app.applicationId) ||
      !!appInfos.find((info) => info.source === 'user' && info.manifest.name === app.name),
    [localVersionByKey, appInfos]
  );

  /** Local-vs-online status, ignoring ownership. */
  const getDiscoverStatus = useCallback(
    (app: Application): DiscoverCardStatus => {
      const status = resolveDiscoverStatus(getLocalVersion(app), app.version, isAppInstalled(app));
      // Skills may be installed outside user-apps (tool dirs); a market
      // "reset" would reinstall into user-apps, so only offer it for apps.
      if (status === 'reset_online' && app.type && app.type !== 'app') return 'installed';
      return status;
    },
    [getLocalVersion, isAppInstalled]
  );

  const getAppStatus = useCallback(
    (app: Application): AppStatus => {
      const status = getDiscoverStatus(app);
      if (status === 'not_installed' && isOwner(app)) return 'owner';
      return status;
    },
    [getDiscoverStatus, isOwner]
  );

  const confirmUpdate = (app: Application) => {
    modal.confirm({
      title: t('workbench.updateConfirmTitle'),
      content: t('workbench.updateConfirmContent', app.name),
      okText: t('appStatus.updateAction'),
      cancelText: t('workbench.cancel'),
      onOk: () => handleUpdate(app.applicationId)
    });
  };

  const confirmReset = (app: Application) => {
    modal.confirm({
      title: t('appStatus.resetConfirmTitle'),
      content: t('appStatus.resetOnlineConfirm', app.name),
      okText: t('appStatus.reset'),
      okType: 'danger',
      cancelText: t('workbench.cancel'),
      onOk: () => handleReset(app.applicationId)
    });
  };

  const openDrawer = async (app: Application) => {
    setDrawerApp(app);
    setDrawerOpen(true);
    setDrawerLoading(true);
    setDrawerDetail(null);
    try {
      const detail = await applicationManager.fetchApplicationDetail(app.applicationId);
      setDrawerDetail(detail);
    } catch {
      // Use basic app info if detail fetch fails
    } finally {
      setDrawerLoading(false);
    }
  };

  const handleInstall = async (appId: string) => {
    // AI skills require the user to choose a placement (4 modes).
    const target = drawerApp?.applicationId === appId ? drawerApp : allApps.find((a) => a.applicationId === appId);
    if (target?.type === 'ai-skill') {
      setSkillInstallApp(target);
      setSkillInstallOpen(true);
      return;
    }
    setInstalling(prev => new Set(prev).add(appId));
    try {
      await applicationManager.installApplication(appId);
      message.success(t('discover.installSuccess'));
      await loadApps();
    } catch (error) {
      console.error('Failed to install app:', error);
      message.error(t('discover.installFailed'));
    } finally {
      setInstalling(prev => {
        const next = new Set(prev);
        next.delete(appId);
        return next;
      });
    }
  };

  const handleConfirmSkillInstall = async (mode: SkillInstallMode, tools: SkillTool[]) => {
    if (!skillInstallApp) return;
    setSkillInstalling(true);
    try {
      const res = await applicationManager.installSkillFromMarket(skillInstallApp.applicationId, {
        mode,
        tools,
        workspacePath: activeWorkspace?.path
      });
      if (res.success) {
        message.success(t('discover.installSuccess'));
        setSkillInstallOpen(false);
        setSkillInstallApp(null);
        await loadApps();
      } else {
        message.error(res.error || t('discover.installFailed'));
      }
    } catch (error) {
      console.error('Failed to install skill:', error);
      message.error(t('discover.installFailed'));
    } finally {
      setSkillInstalling(false);
    }
  };

  const handleUpdate = async (appId: string) => {
    setInstalling(prev => new Set(prev).add(appId));
    try {
      await applicationManager.updateApplication2(appId);
      message.success(t('discover.updateSuccess'));
      await loadApps();
    } catch (error) {
      console.error('Failed to update app:', error);
      message.error(t('discover.updateFailed'));
    } finally {
      setInstalling(prev => {
        const next = new Set(prev);
        next.delete(appId);
        return next;
      });
    }
  };

  const handleReset = async (appId: string) => {
    setInstalling(prev => new Set(prev).add(appId));
    try {
      await applicationManager.resetInstalledApp(appId);
      message.success(t('appStatus.resetSuccess', appId));
      await loadApps();
    } catch (error) {
      console.error('Failed to reset app:', error);
      message.error(t('appStatus.resetFailed'));
    } finally {
      setInstalling(prev => {
        const next = new Set(prev);
        next.delete(appId);
        return next;
      });
    }
  };

  const getTypeLabel = (type: ApplicationType) => {
    switch (type) {
      case 'app': return t('discover.tabApp');
      case 'ai-skill': return t('discover.tabSkill');
      case 'prompt': return t('discover.tabPrompt');
      case 'link': return t('discover.tabLink');
      default: return t('discover.tabApp');
    }
  };

  const renderDrawerContent = () => {
    if (!drawerApp) return null;
    if (drawerLoading) return <div style={{ textAlign: 'center', padding: 48 }}><Spin /></div>;

    const status = getAppStatus(drawerApp);
    const localVer = getLocalVersion(drawerApp);
    const detail = drawerDetail;
    const latestVersion = detail?.versions?.[0];

    return (
      <div>
        <Descriptions column={1} size="small" style={{ marginBottom: 24 }}>
          <Descriptions.Item label={t('discover.description')}>
            {drawerApp.description || '-'}
          </Descriptions.Item>
          <Descriptions.Item label={t('discover.author')}>
            {drawerApp.ownerName || '-'}
          </Descriptions.Item>
          <Descriptions.Item label={t('discover.category')}>
            {drawerApp.category || '-'}
          </Descriptions.Item>
          {isOwner(drawerApp) && (
            <Descriptions.Item label={t('discover.supportedEnv')}>
              {drawerApp.type === 'ai-skill' ? 'Claude Code / Codex / Gemini CLI' : '-'}
            </Descriptions.Item>
          )}
          {status !== 'not_installed' && status !== 'owner' && (
            <Descriptions.Item label={t('discover.version')}>
              {localVer && drawerApp.version && localVer !== drawerApp.version
                ? `v${localVer} → v${drawerApp.version}`
                : `v${localVer || drawerApp.version || latestVersion?.version || '-'}`}
            </Descriptions.Item>
          )}
        </Descriptions>

        {(status === 'pending_update' || status === 'reset_online') && (
          <div style={{ marginBottom: 24 }}>
            <div style={{
              padding: 12,
              borderRadius: 8,
              background: token.colorBgLayout
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <Text type="secondary">{t('discover.currentVersion')}</Text>
                <Tag>{localVer || '-'}</Tag>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <Text type="secondary">{t('discover.latestVersion')}</Text>
                <Tag color="blue">{drawerApp.version || '-'}</Tag>
              </div>
              {latestVersion?.changelog && (
                <div style={{ marginTop: 12 }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>{t('discover.changelog')}</Text>
                  <div style={{ marginTop: 4, fontSize: 13 }}>{latestVersion.changelog}</div>
                </div>
              )}
            </div>
          </div>
        )}

        {status === 'pending_update' && (
          <Button
            type="primary"
            block
            icon={<SyncOutlined />}
            loading={installing.has(drawerApp.applicationId)}
            onClick={() => handleUpdate(drawerApp.applicationId)}
          >
            {installing.has(drawerApp.applicationId) ? t('discover.updating') : t('appStatus.updateAction')}
          </Button>
        )}

        {status === 'reset_online' && (
          <Button
            type="primary"
            danger
            block
            icon={<SyncOutlined />}
            loading={installing.has(drawerApp.applicationId)}
            onClick={() => confirmReset(drawerApp)}
          >
            {t('appStatus.resetOnline')}
          </Button>
        )}

        {(status === 'not_installed' || status === 'owner') && (
          <Button
            type="primary"
            block
            icon={<DownloadOutlined />}
            loading={installing.has(drawerApp.applicationId)}
            onClick={() => handleInstall(drawerApp.applicationId)}
          >
            {installing.has(drawerApp.applicationId) ? t('discover.installing') : t('discover.install')}
          </Button>
        )}
      </div>
    );
  };

  /** Round action on the card's bottom-right, by status. */
  const renderCardAction = (app: Application, status: AppStatus) => {
    const stop = (fn: () => void) => (e: React.MouseEvent) => {
      e.stopPropagation();
      fn();
    };
    const isProcessing = installing.has(app.applicationId);
    switch (status) {
      case 'owner':
        return (
          <Tooltip title={t('discover.owner')}>
            <button type="button" className="cb-round-action-btn cb-round-action-neutral" onClick={stop(() => openDrawer(app))}>
              <CrownOutlined style={{ fontSize: 14, color: token.colorWarning }} />
            </button>
          </Tooltip>
        );
      case 'installed':
        return (
          <Tooltip title={t(discoverStatusLabelKey(status))}>
            <button type="button" className="cb-round-action-btn cb-round-action-neutral" onClick={stop(() => openDrawer(app))}>
              <CheckCircleOutlined style={{ fontSize: 14, color: token.colorSuccess }} />
            </button>
          </Tooltip>
        );
      case 'pending_update':
        return (
          <Tooltip title={t('appStatus.updateAction')}>
            <button
              type="button"
              className={`cb-round-action-btn cb-round-action-primary${isProcessing ? ' is-loading' : ''}`}
              disabled={isProcessing}
              onClick={stop(() => confirmUpdate(app))}
            >
              {isProcessing ? <SyncOutlined spin style={{ fontSize: 14 }} /> : <CloudDownloadOutlined style={{ fontSize: 14 }} />}
            </button>
          </Tooltip>
        );
      case 'reset_online':
        return (
          <Tooltip title={t('appStatus.resetOnline')}>
            <button
              type="button"
              className={`cb-round-action-btn cb-round-action-neutral${isProcessing ? ' is-loading' : ''}`}
              disabled={isProcessing}
              onClick={stop(() => confirmReset(app))}
            >
              <SyncOutlined spin={isProcessing} style={{ fontSize: 13, color: token.colorWarning }} />
            </button>
          </Tooltip>
        );
      case 'not_installed':
        return (
          <Tooltip title={isProcessing ? t('discover.installing') : t('discover.install')}>
            <button
              type="button"
              className={`cb-round-action-btn cb-round-action-primary${isProcessing ? ' is-loading' : ''}`}
              disabled={isProcessing}
              onClick={stop(() => openDrawer(app))}
            >
              {isProcessing ? <SyncOutlined spin style={{ fontSize: 14 }} /> : <DownloadOutlined style={{ fontSize: 14 }} />}
            </button>
          </Tooltip>
        );
    }
  };

  const renderAppCard = (app: Application) => {
    const status = getAppStatus(app);
    const discoverStatus = getDiscoverStatus(app);
    const localVer = getLocalVersion(app);
    const owned = isOwner(app);
    const isDraft = owned && !app.published;
    const isBuiltin = isBuiltinAppId(app.applicationId);
    const isPinned = pinnedApps.includes(app.applicationId);
    const variant = isBuiltin ? 'builtin' : isDraft ? 'draft' : owned ? 'own-published' : 'regular';
    const iconUrl =
      (typeof app.metadata?.icon === 'string' && app.metadata.icon) ||
      (typeof app.metadata?.coverUrl === 'string' && app.metadata.coverUrl) ||
      undefined;

    return (
      <FolderCard
        key={app.applicationId}
        variant={variant}
        pinned={isPinned}
        style={{ cursor: 'pointer' }}
        onClick={() => openDrawer(app)}
        notchActions={
          <Tooltip title={t('agents.viewDetail')}>
            <button
              type="button"
              className="cb-notch-btn"
              onClick={(e) => {
                e.stopPropagation();
                openDrawer(app);
              }}
            >
              <MoreOutlined style={{ fontSize: 13 }} />
            </button>
          </Tooltip>
        }
      >
        {/* Icon + title */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 32, width: 'calc(100% - 74px)' }}>
          <AppIcon icon={iconUrl} name={app.name} category={app.category} size={28} />
          <Tooltip title={app.name}>
            <Text strong ellipsis style={{ fontSize: 13, lineHeight: '20px' }}>
              {app.name}
            </Text>
          </Tooltip>
        </div>

        {/* Single-line description */}
        <div
          className="cb-card-desc"
          style={{
            fontSize: 12,
            lineHeight: '18px',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            margin: '6px 0'
          }}
        >
          {app.description || t('workbench.noDesc')}
        </div>

        {/* Tags */}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', minHeight: 20, marginBottom: 8 }}>
          {owned && (
            <Tag icon={<CrownOutlined />} color="gold" style={SMALL_TAG_STYLE}>
              {t('discover.owner')}
            </Tag>
          )}
          {isBuiltin && (
            <Tag color="blue" style={SMALL_TAG_STYLE}>
              {t('appStatus.builtin')}
            </Tag>
          )}
          {isDraft && (
            <Tag color="orange" style={SMALL_TAG_STYLE}>
              {t('appStatus.draft')}
            </Tag>
          )}
          {discoverStatus === 'pending_update' && (
            <Tag color="processing" style={SMALL_TAG_STYLE}>
              {t('appStatus.pendingUpdate')}
            </Tag>
          )}
          {discoverStatus === 'reset_online' && (
            <Tag color="warning" style={SMALL_TAG_STYLE}>
              {t('appStatus.resetOnline')}
            </Tag>
          )}
          {app.category && app.category !== 'general' && app.category !== 'other' && (
            <Tag style={SMALL_TAG_STYLE}>{app.category}</Tag>
          )}
        </div>

        {/* Version + action */}
        <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 8 }}>
          <div>
            {app.version && (
              <AppVersionTag localVersion={localVer} remoteVersion={app.version} status={discoverStatus} />
            )}
          </div>
          {renderCardAction(app, status)}
        </div>
      </FolderCard>
    );
  };

  const tabItems = [
    { key: 'app', label: t('discover.tabApp') },
    { key: 'ai-skill', label: t('discover.tabSkill') },
    { key: 'prompt', label: t('discover.tabPrompt') },
    { key: 'link', label: t('discover.tabLink') },
  ];

  return (
    <div style={{ padding: 24 }}>
      {/* 顶部工具栏 */}
      <div style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
            <Button
              type="text"
              icon={<ArrowLeftOutlined />}
              onClick={() => navigate(backTarget)}
            >
              {t('discover.back')}
            </Button>
            <Title level={4} style={{ margin: 0 }}>{t('discover.title')}</Title>
          </div>
          {!isLocalMode && (
            <Search
              placeholder={t('discover.searchPlaceholder')}
              allowClear
              enterButton={<SearchOutlined />}
              size="large"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              onSearch={filterApps}
            />
          )}
        </div>
        <Space.Compact size="large">
          <Button
            icon={<SnippetsOutlined />}
            onClick={() => navigate('/workbench/my-contributions', { state: { from: location.pathname } })}
          >
            {t('discover.mine')}
          </Button>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setCreateModalOpen(true)}
          >
            {t('discover.create')}
          </Button>
        </Space.Compact>
      </div>

      {isLocalMode && (
        <Alert
          type="info"
          message={t('discover.localMode')}
          description={t('discover.localModeDesc')}
          showIcon
          style={{ marginBottom: 24 }}
        />
      )}

      {/* 三类 Tab */}
      {!isLocalMode && (
        <>
          <Tabs
            activeKey={activeTab}
            onChange={(key) => {
              setActiveTab(key as ApplicationType);
              setSearchText('');
            }}
            items={tabItems}
            style={{ marginBottom: 16 }}
          />

          {loading ? (
            <div style={{ textAlign: 'center', padding: 48 }}>
              <Spin size="large" />
            </div>
          ) : filteredApps.length === 0 ? (
            <Empty description={searchText ? t('discover.noMatch') : t('discover.noPublished', getTypeLabel(activeTab))} />
          ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))',
                gap: 12
              }}
            >
              {filteredApps.map((app) => renderAppCard(app))}
            </div>
          )}
        </>
      )}

      <Drawer
        title={drawerApp?.name}
        placement="right"
        width={400}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
      >
        {renderDrawerContent()}
      </Drawer>

      <CreateTypeModal
        open={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
      />

      <SkillInstallModal
        open={skillInstallOpen}
        title={skillInstallApp ? t('skill.install.titleFor', skillInstallApp.name) : undefined}
        hasWorkspace={!!activeWorkspace?.path}
        workspaceName={activeWorkspace?.name}
        confirmLoading={skillInstalling}
        onCancel={() => {
          setSkillInstallOpen(false);
          setSkillInstallApp(null);
        }}
        onConfirm={handleConfirmSkillInstall}
      />
    </div>
  );
};

export default AppLibraryPage;
