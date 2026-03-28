/**
 * 应用详情页
 * 显示应用完整信息、版本历史、安装/更新/卸载按钮
 */

import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Typography,
  Card,
  Button,
  Descriptions,
  Timeline,
  Spin,
  message,
  Tag,
  Space,
  Divider,
} from 'antd';
import {
  ArrowLeftOutlined,
  DownloadOutlined,
  SyncOutlined,
  DeleteOutlined,
  EditOutlined,
} from '@ant-design/icons';
import { applicationManager } from '../../services/applicationManager';
import { localStorageManager } from '../../services/localStorageManager';
import { apiClient } from '../../services/apiClient';
import type { ApplicationDetail } from '../../types/api';
import { useT } from '../../i18n';

const { Title, Paragraph, Text } = Typography;

const AppDetailPage: React.FC = () => {
  const { appId } = useParams<{ appId: string }>();
  const navigate = useNavigate();
  const t = useT();
  const [loading, setLoading] = useState(true);
  const [app, setApp] = useState<ApplicationDetail | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [hasUpdate, setHasUpdate] = useState(false);
  const [operating, setOperating] = useState(false);
  const [isOwner, setIsOwner] = useState(false);

  useEffect(() => {
    if (appId) {
      loadAppDetail();
    }
  }, [appId]);

  const loadAppDetail = async () => {
    if (!appId) return;

    setLoading(true);
    try {
      const detail = await applicationManager.fetchApplicationDetail(appId);
      setApp(detail);

      // 检查是否已安装
      const installed = localStorageManager.isAppInstalled(appId);
      setIsInstalled(installed);

      // 检查是否有更新
      if (installed) {
        const installedApp = localStorageManager.getInstalledApp(appId);
        if (installedApp) {
          const hasNewVersion =
            applicationManager['compareVersions'](installedApp.localVersion || '', detail.version) < 0;
          setHasUpdate(hasNewVersion);
        }
      }

      // 检查是否是所有者
      if (apiClient.isLoggedIn()) {
        const user = await apiClient.getCurrentUser();
        setIsOwner(user.userId === detail.ownerId);
      }
    } catch (error) {
      console.error('Failed to load app detail:', error);
      message.error('加载应用详情失败');
    } finally {
      setLoading(false);
    }
  };

  const handleInstall = async () => {
    if (!appId) return;

    setOperating(true);
    try {
      await applicationManager.installApplication(appId);
      message.success('安装成功');
      setIsInstalled(true);
    } catch (error) {
      console.error('Failed to install app:', error);
      message.error('安装失败');
    } finally {
      setOperating(false);
    }
  };

  const handleUpdate = async () => {
    if (!appId) return;

    setOperating(true);
    try {
      await applicationManager.updateApplication2(appId);
      message.success('更新成功');
      setHasUpdate(false);
      await loadAppDetail();
    } catch (error) {
      console.error('Failed to update app:', error);
      message.error('更新失败');
    } finally {
      setOperating(false);
    }
  };

  const handleUninstall = async () => {
    if (!appId) return;

    setOperating(true);
    try {
      await applicationManager.uninstallApplication(appId);
      message.success('卸载成功');
      setIsInstalled(false);
      setHasUpdate(false);
    } catch (error) {
      console.error('Failed to uninstall app:', error);
      message.error('卸载失败');
    } finally {
      setOperating(false);
    }
  };

  const handleEdit = () => {
    navigate(`/developer/edit/${appId}`);
  };

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 48 }}>
        <Spin size="large" />
      </div>
    );
  }

  if (!app) {
    return (
      <div style={{ padding: 24 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(-1)}>
          返回
        </Button>
        <div style={{ textAlign: 'center', padding: 48 }}>
          <Text type="secondary">应用不存在</Text>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: 24 }}>
      <Button
        icon={<ArrowLeftOutlined />}
        onClick={() => navigate(-1)}
        style={{ marginBottom: 16 }}
      >
        {t('common.back')}
      </Button>

      <Card>
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <Title level={3} style={{ marginBottom: 8 }}>
                {app.name}
              </Title>
              <Space>
                <Tag color="blue">{app.category}</Tag>
                <Tag color={app.published ? 'success' : 'warning'}>
                  {app.published ? '已发布' : '未发布'}
                </Tag>
                {isInstalled && <Tag color="success">已安装</Tag>}
                {hasUpdate && <Tag color="orange">有更新</Tag>}
              </Space>
            </div>
            <Space>
              {isOwner && (
                <Button icon={<EditOutlined />} onClick={handleEdit}>
                  编辑
                </Button>
              )}
              {!isInstalled && (
                <Button
                  type="primary"
                  icon={<DownloadOutlined />}
                  loading={operating}
                  onClick={handleInstall}
                >
                  安装
                </Button>
              )}
              {isInstalled && hasUpdate && (
                <Button
                  type="primary"
                  icon={<SyncOutlined />}
                  loading={operating}
                  onClick={handleUpdate}
                >
                  更新
                </Button>
              )}
              {isInstalled && (
                <Button
                  danger
                  icon={<DeleteOutlined />}
                  loading={operating}
                  onClick={handleUninstall}
                >
                  卸载
                </Button>
              )}
            </Space>
          </div>
        </div>

        <Divider />

        <Descriptions title="应用信息" column={2} bordered>
          <Descriptions.Item label="当前版本">{app.version}</Descriptions.Item>
          <Descriptions.Item label="下载次数">{app.downloadCount}</Descriptions.Item>
          <Descriptions.Item label="开发者">{app.ownerName}</Descriptions.Item>
          <Descriptions.Item label="分类">{app.category}</Descriptions.Item>
          <Descriptions.Item label="创建时间">
            {new Date(app.createdAt).toLocaleString()}
          </Descriptions.Item>
          <Descriptions.Item label="更新时间">
            {new Date(app.updatedAt).toLocaleString()}
          </Descriptions.Item>
        </Descriptions>

        <Divider />

        <div style={{ marginBottom: 24 }}>
          <Title level={5}>应用描述</Title>
          <Paragraph>{app.description}</Paragraph>
        </div>

        {app.metadata && Object.keys(app.metadata).length > 0 && (
          <>
            <Divider />
            <div style={{ marginBottom: 24 }}>
              <Title level={5}>其他信息</Title>
              <Descriptions column={1} bordered>
                {Object.entries(app.metadata).map(([key, value]) => (
                  <Descriptions.Item key={key} label={key}>
                    {JSON.stringify(value)}
                  </Descriptions.Item>
                ))}
              </Descriptions>
            </div>
          </>
        )}

        {app.versions && app.versions.length > 0 && (
          <>
            <Divider />
            <div>
              <Title level={5}>版本历史</Title>
              <Timeline
                items={app.versions.map((version) => ({
                  children: (
                    <div>
                      <div style={{ marginBottom: 4 }}>
                        <Text strong>版本 {version.version}</Text>
                        <Text type="secondary" style={{ marginLeft: 16, fontSize: 12 }}>
                          {new Date(version.publishedAt).toLocaleString()}
                        </Text>
                      </div>
                      {version.changelog && (
                        <Paragraph style={{ marginBottom: 4 }}>{version.changelog}</Paragraph>
                      )}
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        大小: {(version.fileSize / 1024 / 1024).toFixed(2)} MB
                      </Text>
                    </div>
                  ),
                }))}
              />
            </div>
          </>
        )}
      </Card>
    </div>
  );
};

export default AppDetailPage;
