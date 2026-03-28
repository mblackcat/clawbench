/**
 * 发现页面（原应用中心）
 * 混合市场：应用 / AI 技能 / 提示词 三类 Tab
 * 卡片按状态显示 Owner/Installed/Update/Install 按钮，点击打开 Drawer
 */

import React, { useEffect, useState, useCallback } from 'react';
import { Typography, Row, Col, Empty, Spin, Tag, Input, Tooltip, theme, Button, App, Alert, Tabs, Drawer, Descriptions, Space } from 'antd';
import {
  SearchOutlined,
  PlusOutlined,
  SnippetsOutlined,
  ArrowLeftOutlined,
  CheckCircleOutlined,
  DownloadOutlined,
  SyncOutlined,
  CrownOutlined
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { applicationManager } from '../../services/applicationManager';
import type { InstalledApp, UpdateInfo } from '../../services/applicationManager';
import { localStorageManager } from '../../services/localStorageManager';
import type { Application, ApplicationType, ApplicationDetail } from '../../types/api';
import { useSubAppStore } from '../../stores/useSubAppStore';
import { useAuthStore } from '../../stores/useAuthStore';
import CreateTypeModal from '../../components/CreateTypeModal';
import { useT } from '../../i18n';

const { Title, Text } = Typography;
const { Search } = Input;

type AppStatus = 'owner' | 'installed' | 'update' | 'not_installed';

const AppLibraryPage: React.FC = () => {
  const navigate = useNavigate();
  const { token } = theme.useToken();
  const { message } = App.useApp();
  const t = useT();
  const [loading, setLoading] = useState(true);
  const [allApps, setAllApps] = useState<Application[]>([]);
  const [filteredApps, setFilteredApps] = useState<Application[]>([]);
  const [searchText, setSearchText] = useState('');
  const [activeTab, setActiveTab] = useState<ApplicationType>('app');
  const [installing, setInstalling] = useState<Set<string>>(new Set());
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [updateInfoMap, setUpdateInfoMap] = useState<Map<string, UpdateInfo>>(new Map());

  // Drawer state
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerApp, setDrawerApp] = useState<Application | null>(null);
  const [drawerDetail, setDrawerDetail] = useState<ApplicationDetail | null>(null);
  const [drawerLoading, setDrawerLoading] = useState(false);

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

      if (!isLocalMode) {
        const publishedApps = await applicationManager.fetchApplications(true, activeTab);
        setAllApps(publishedApps);
        setFilteredApps(publishedApps);

        // Check for updates
        try {
          const updates = await applicationManager.checkForUpdates();
          const map = new Map<string, UpdateInfo>();
          for (const u of updates) {
            map.set(u.applicationId, u);
          }
          setUpdateInfoMap(map);
        } catch {
          // non-critical
        }
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

  const getAppStatus = useCallback((app: Application): AppStatus => {
    // Check if owner
    const currentUserId = user?.id;
    if (currentUserId && app.ownerId === currentUserId) {
      return 'owner';
    }

    // Check if installed
    const installed = localStorageManager.isAppInstalled(app.applicationId) ||
      !!appInfos.find(info => info.source === 'user' && info.manifest.name === app.name);

    if (installed) {
      // Check if has update
      const updateInfo = updateInfoMap.get(app.applicationId);
      if (updateInfo?.hasUpdate) {
        return 'update';
      }
      return 'installed';
    }

    return 'not_installed';
  }, [user, appInfos, updateInfoMap]);

  const getStatusButton = (app: Application, status: AppStatus) => {
    const isProcessing = installing.has(app.applicationId);

    switch (status) {
      case 'owner':
        return (
          <Button
            type="text"
            size="small"
            icon={<CrownOutlined />}
            style={{ color: token.colorWarning }}
            onClick={(e) => { e.stopPropagation(); openDrawer(app); }}
          >
            {t('discover.owner')}
          </Button>
        );
      case 'installed':
        return (
          <Button
            type="text"
            size="small"
            icon={<CheckCircleOutlined />}
            style={{ color: token.colorSuccess }}
            onClick={(e) => { e.stopPropagation(); openDrawer(app); }}
          >
            {t('discover.installed')}
          </Button>
        );
      case 'update':
        return (
          <Button
            type="text"
            size="small"
            icon={<SyncOutlined />}
            style={{ color: token.colorPrimary }}
            onClick={(e) => { e.stopPropagation(); openDrawer(app); }}
          >
            {t('discover.update')}
          </Button>
        );
      case 'not_installed':
        return (
          <Button
            type="link"
            size="small"
            icon={<DownloadOutlined />}
            loading={isProcessing}
            onClick={(e) => { e.stopPropagation(); openDrawer(app); }}
          >
            {isProcessing ? t('discover.installing') : t('discover.install')}
          </Button>
        );
    }
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

  const getTypeLabel = (type: ApplicationType) => {
    switch (type) {
      case 'app': return t('discover.tabApp');
      case 'ai-skill': return t('discover.tabSkill');
      case 'prompt': return t('discover.tabPrompt');
    }
  };

  const renderDrawerContent = () => {
    if (!drawerApp) return null;
    if (drawerLoading) return <div style={{ textAlign: 'center', padding: 48 }}><Spin /></div>;

    const status = getAppStatus(drawerApp);
    const updateInfo = updateInfoMap.get(drawerApp.applicationId);
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
          {status === 'owner' && (
            <Descriptions.Item label={t('discover.supportedEnv')}>
              {drawerApp.type === 'ai-skill' ? 'Claude Code / Codex / Gemini CLI' : '-'}
            </Descriptions.Item>
          )}
          {(status === 'installed' || status === 'update') && (
            <Descriptions.Item label={t('discover.version')}>
              {updateInfo?.currentVersion || latestVersion?.version || '-'}
            </Descriptions.Item>
          )}
        </Descriptions>

        {status === 'update' && updateInfo && (
          <div style={{ marginBottom: 24 }}>
            <div style={{
              padding: 12,
              borderRadius: 8,
              background: token.colorBgLayout
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <Text type="secondary">{t('discover.currentVersion')}</Text>
                <Tag>{updateInfo.currentVersion}</Tag>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <Text type="secondary">{t('discover.latestVersion')}</Text>
                <Tag color="blue">{updateInfo.latestVersion}</Tag>
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

        {status === 'update' && (
          <Button
            type="primary"
            block
            icon={<SyncOutlined />}
            loading={installing.has(drawerApp.applicationId)}
            onClick={() => handleUpdate(drawerApp.applicationId)}
          >
            {installing.has(drawerApp.applicationId) ? t('discover.updating') : t('discover.update')}
          </Button>
        )}

        {status === 'not_installed' && (
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

  const renderAppCard = (app: Application) => {
    const status = getAppStatus(app);

    return (
      <div
        key={app.applicationId}
        className="cb-glass-card"
        style={{ cursor: 'pointer' }}
        onClick={() => openDrawer(app)}
      >
        <div style={{ padding: '12px 16px', minHeight: 72, flex: 1 }}>
          <div style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 8,
            marginBottom: 8,
            minHeight: 44
          }}>
            <Tooltip title={app.name}>
              <Text
                strong
                style={{
                  flex: 1,
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                  wordBreak: 'break-word',
                  lineHeight: '22px',
                  minHeight: 44
                }}
              >
                {app.name}
              </Text>
            </Tooltip>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {app.category && app.category !== 'general' && <Tag style={{ margin: 0 }}>{app.category}</Tag>}
          </div>
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            borderTop: `1px solid ${token.colorBorderSecondary}`,
            padding: '4px 0'
          }}
        >
          {getStatusButton(app, status)}
        </div>
      </div>
    );
  };

  const tabItems = [
    { key: 'app', label: t('discover.tabApp') },
    { key: 'ai-skill', label: t('discover.tabSkill') },
    { key: 'prompt', label: t('discover.tabPrompt') },
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
              onClick={() => navigate(-1)}
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
            onClick={() => navigate('/apps/my-contributions')}
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
            <Row gutter={[16, 16]}>
              {filteredApps.map((app) => (
                <Col key={app.applicationId} xs={24} sm={12} md={8} lg={6}>
                  {renderAppCard(app)}
                </Col>
              ))}
            </Row>
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
    </div>
  );
};

export default AppLibraryPage;
