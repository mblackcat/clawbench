/**
 * 我的页面
 * 展示用户本地创建的所有 app/skill/prompt
 */

import React, { useEffect, useState, useMemo } from 'react';
import { Typography, Row, Col, Empty, Tag, Tooltip, theme, Button, App } from 'antd';
import {
  EditOutlined,
  CloudUploadOutlined,
  PlayCircleOutlined,
  ArrowLeftOutlined
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { applicationManager } from '../../services/applicationManager';
import type { Application } from '../../types/api';
import { useSubAppStore } from '../../stores/useSubAppStore';
import { useAuthStore } from '../../stores/useAuthStore';
import type { SubAppManifest } from '../../types/subapp';
import { useTaskStore } from '../../stores/useTaskStore';
import { useT } from '../../i18n';

const { Title, Text } = Typography;

interface SubAppInfo {
  id: string
  manifest: SubAppManifest
  path: string
  source: 'user'
}

type AppType = 'draft' | 'local' | 'published';

interface LocalAppWithType extends SubAppInfo {
  appType: AppType
}

const MyContributionsPage: React.FC = () => {
  const navigate = useNavigate();
  const { token } = theme.useToken();
  const { message } = App.useApp();
  const t = useT();
  const [localApps, setLocalApps] = useState<LocalAppWithType[]>([]);
  const [allApps, setAllApps] = useState<Application[]>([]);

  const fetchApps = useSubAppStore((state) => state.fetchApps);
  const appInfos = useSubAppStore((state) => state.appInfos);
  const user = useAuthStore((state) => state.user);
  const isLocalMode = useAuthStore((state) => state.isLocalMode);
  const startTask = useTaskStore((state) => state.startTask);
  const setActiveTask = useTaskStore((state) => state.setActiveTask);

  useEffect(() => {
    loadApps();
  }, []);

  useEffect(() => {
    classifyLocalApps();
  }, [appInfos, user, allApps]);

  const loadApps = async () => {
    try {
      await fetchApps();
      if (!isLocalMode) {
        const publishedApps = await applicationManager.fetchApplications(true);
        setAllApps(publishedApps);
      }
    } catch (error) {
      console.error('Failed to load apps:', error);
    }
  };

  const classifyLocalApps = () => {
    const publishedAppNames = new Set(allApps.map(a => a.name));

    const classified: LocalAppWithType[] = appInfos
      .filter(info => info.source === 'user')
      .map(info => {
        const manifest = info.manifest;
        let appType: AppType = 'local';

        if (publishedAppNames.has(manifest.name)) {
          appType = 'published';
        } else {
          const authorId = getAuthorId(manifest.author);
          const currentUserId = user?.feishu_id || user?.id;
          if (authorId && currentUserId && authorId === currentUserId) {
            appType = 'draft';
          }
        }

        return { ...info, appType };
      });

    setLocalApps(classified);
  };

  /** 按 manifest.type 分成三组：应用 → AI 技能 → 提示词 */
  const groupedApps = useMemo(() => {
    const groups: { key: string; label: string; items: LocalAppWithType[] }[] = [
      { key: 'app', label: t('mine.groupApp'), items: [] },
      { key: 'ai-skill', label: t('mine.groupSkill'), items: [] },
      { key: 'prompt', label: t('mine.groupPrompt'), items: [] }
    ];
    const groupMap = new Map(groups.map(g => [g.key, g]));
    for (const app of localApps) {
      const type = app.manifest.type || 'app';
      const group = groupMap.get(type);
      if (group) {
        group.items.push(app);
      } else {
        groupMap.get('app')!.items.push(app);
      }
    }
    return groups.filter(g => g.items.length > 0);
  }, [localApps, t]);

  const getAuthorId = (author: string | { name: string; email?: string; feishu_id?: string } | undefined): string | undefined => {
    if (!author) return undefined;
    if (typeof author === 'string') return undefined;
    return author.feishu_id;
  };

  const getAppTypeTag = (appType: AppType) => {
    switch (appType) {
      case 'draft':
        return <Tag color="orange" style={{ margin: 0 }}>{t('mine.draft')}</Tag>;
      case 'published':
        return <Tag color="green" style={{ margin: 0 }}>{t('mine.published')}</Tag>;
      case 'local':
        return <Tag color="default" style={{ margin: 0 }}>{t('mine.local')}</Tag>;
    }
  };

  const handleEdit = (appId: string, type?: string) => {
    if (type === 'ai-skill') {
      navigate('/developer/new-skill', { state: { appId } });
    } else if (type === 'prompt') {
      navigate('/developer/new-prompt', { state: { appId } });
    } else {
      navigate('/developer/new', { state: { appId } });
    }
  };

  const handlePublish = (appId: string) => {
    navigate('/developer/publish', { state: { appId } });
  };

  const handleRun = async (appId: string, appName: string) => {
    try {
      const taskId = await window.api.subapp.execute(appId, {});
      startTask(taskId, appId, appName);
      setActiveTask(taskId);
      message.success(t('mine.appStarted', appName));
    } catch (error) {
      console.error('Failed to run app:', error);
      message.error(t('mine.runFailed'));
    }
  };

  const renderLocalAppCard = (appWithType: LocalAppWithType) => {
    const { id, manifest, appType } = appWithType;
    const app = manifest;
    const isApp = !app.type || app.type === 'app';

    return (
      <div key={id} className="cb-glass-card">
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
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <Tag style={{ margin: 0 }}>v{app.version}</Tag>
            {getAppTypeTag(appType)}
          </div>
        </div>
        <div
          style={{
            display: 'flex',
            borderTop: `1px solid ${token.colorBorderSecondary}`
          }}
        >
          <div
            onClick={() => handleEdit(id, app.type)}
            style={{
              flex: 1,
              padding: '8px 0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              cursor: 'pointer',
              color: token.colorTextSecondary,
              fontWeight: 500,
              fontSize: 13
            }}
          >
            <EditOutlined /> {t('mine.edit')}
          </div>

          <div style={{ width: 1, alignSelf: 'stretch', background: token.colorBorderSecondary }} />
          <div
            onClick={() => handlePublish(id)}
            style={{
              flex: 1,
              padding: '8px 0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              cursor: 'pointer',
              color: token.colorPrimary,
              fontWeight: 500,
              fontSize: 13
            }}
          >
            <CloudUploadOutlined /> {appType === 'published' ? t('mine.republish') : t('mine.publish')}
          </div>

          {isApp && (
            <>
              <div style={{ width: 1, alignSelf: 'stretch', background: token.colorBorderSecondary }} />
              <div
                onClick={() => handleRun(id, app.name)}
                style={{
                  flex: 1,
                  padding: '8px 0',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  cursor: 'pointer',
                  color: token.colorSuccess,
                  fontWeight: 500,
                  fontSize: 13
                }}
              >
                <PlayCircleOutlined /> {t('mine.run')}
              </div>
            </>
          )}
        </div>
      </div>
    );
  };

  return (
    <div style={{ padding: 24 }}>
      <div style={{ marginBottom: 24, display: 'flex', alignItems: 'center', gap: 12 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/apps/installed')}>
          {t('common.back')}
        </Button>
        <Title level={4} style={{ margin: 0 }}>{t('mine.title')}</Title>
      </div>

      {localApps.length === 0 ? (
        <Empty description={t('mine.noContent')} />
      ) : (
        groupedApps.map((group) => (
          <div key={group.key} style={{ marginBottom: 24 }}>
            <Text
              type="secondary"
              style={{
                display: 'block',
                marginBottom: 12,
                fontSize: 13,
                fontWeight: 500
              }}
            >
              {group.label}
            </Text>
            <Row gutter={[16, 16]}>
              {group.items.map((app) => (
                <Col key={app.id} xs={24} sm={12} md={8} lg={6}>
                  {renderLocalAppCard(app)}
                </Col>
              ))}
            </Row>
          </div>
        ))
      )}
    </div>
  );
};

export default MyContributionsPage;
