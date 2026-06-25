/**
 * Link 编辑器
 * 创建/编辑链接卡片 — title / url / icon / mini
 */

import React, { useState, useEffect, useRef } from 'react';
import { Typography, Input, Button, App, theme, Switch } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../../stores/useAuthStore';
import { useT } from '../../i18n';

const { Title, Text } = Typography;

const LinkEditor: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { token } = theme.useToken();
  const { message } = App.useApp();
  const user = useAuthStore((state) => state.user);
  const t = useT();

  const editAppId = (location.state as any)?.appId;
  const fromPath = (location.state as any)?.from as string | undefined;
  const backTarget = fromPath || '/apps/my-contributions';
  const savingRef = useRef(false);
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState('');
  const [version, setVersion] = useState('1.0.0');
  const [url, setUrl] = useState('');
  const [icon, setIcon] = useState('');
  const [mini, setMini] = useState(false);

  useEffect(() => {
    if (editAppId) {
      loadExisting(editAppId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editAppId]);

  const loadExisting = async (appId: string) => {
    try {
      const appPath = await window.api.developer.getAppPath(appId);
      const manifestStr = await window.api.developer.readFile(`${appPath}/manifest.json`);
      const manifest = JSON.parse(manifestStr);
      setName(manifest.name || '');
      setVersion(manifest.version || '1.0.0');
      setUrl(manifest.url || '');
      setIcon(manifest.icon || '');
      setMini(!!manifest.mini);
    } catch (error) {
      console.error('Failed to load link:', error);
      message.error(t('linkEditor.loadFailed'));
    }
  };

  const normalizeUrl = (raw: string): string => {
    const trimmed = raw.trim();
    if (!trimmed) return '';
    return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  };

  const handleSave = async () => {
    if (!name.trim()) {
      message.error(t('linkEditor.nameRequired'));
      return;
    }
    const finalUrl = normalizeUrl(url);
    if (!finalUrl) {
      message.error(t('linkEditor.urlRequired'));
      return;
    }
    try {
      // eslint-disable-next-line no-new
      new URL(finalUrl);
    } catch {
      message.error(t('linkEditor.urlInvalid'));
      return;
    }

    if (savingRef.current) return;
    savingRef.current = true;
    setLoading(true);
    try {
      const manifest = {
        id: editAppId || `${crypto.randomUUID().slice(0, 8)}-link`,
        name: name.trim(),
        version: version.trim() || '1.0.0',
        description: '',
        type: 'link' as const,
        entry: 'link.json',
        url: finalUrl,
        icon: icon.trim() || undefined,
        mini,
        author: user ? { name: user.username, feishu_id: (user as any).feishu_id || '' } : 'unknown',
      };

      const linkData = JSON.stringify({ url: finalUrl, icon: icon.trim() || '', mini }, null, 2);

      if (editAppId) {
        await window.api.developer.updateApp(editAppId, manifest);
        const appPath = await window.api.developer.getAppPath(editAppId);
        await window.api.developer.writeFile(`${appPath}/link.json`, linkData);
        message.success(t('linkEditor.updated'));
      } else {
        const appPath = await window.api.developer.createApp(manifest);
        await window.api.developer.writeFile(`${appPath}/link.json`, linkData);
        message.success(t('linkEditor.created'));
      }

      navigate(backTarget);
    } catch (error) {
      console.error('Failed to save link:', error);
      message.error(t('linkEditor.saveFailed'));
    } finally {
      setLoading(false);
      savingRef.current = false;
    }
  };

  return (
    <div style={{ padding: 24, maxWidth: 640 }}>
      <div style={{ marginBottom: 24, display: 'flex', alignItems: 'center', gap: 12 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(backTarget)}>
          {t('common.back')}
        </Button>
        <Title level={4} style={{ margin: 0 }}>
          {editAppId ? t('linkEditor.editTitle') : t('linkEditor.createTitle')}
        </Title>
      </div>

      <div style={{ marginBottom: 16 }}>
        <Text strong>{t('linkEditor.name')}</Text>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('linkEditor.namePlaceholder')}
          style={{ marginTop: 8 }}
        />
      </div>

      <div style={{ marginBottom: 16 }}>
        <Text strong>{t('linkEditor.url')}</Text>
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={t('linkEditor.urlPlaceholder')}
          style={{ marginTop: 8 }}
        />
      </div>

      <div style={{ marginBottom: 16 }}>
        <Text strong>{t('linkEditor.icon')}</Text>
        <Input
          value={icon}
          onChange={(e) => setIcon(e.target.value)}
          placeholder={t('linkEditor.iconPlaceholder')}
          style={{ marginTop: 8 }}
        />
        <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 4 }}>
          {t('linkEditor.iconHelp')}
        </Text>
      </div>

      <div style={{ marginBottom: 24, display: 'flex', alignItems: 'center', gap: 12 }}>
        <Switch checked={mini} onChange={setMini} />
        <div>
          <Text strong>{t('linkEditor.mini')}</Text>
          <Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
            {t('linkEditor.miniHelp')}
          </Text>
        </div>
      </div>

      <div style={{ marginBottom: 24, maxWidth: 200 }}>
        <Text strong>{t('linkEditor.version')}</Text>
        <Input
          value={version}
          onChange={(e) => setVersion(e.target.value)}
          placeholder="1.0.0"
          style={{ marginTop: 8 }}
        />
      </div>

      <Button type="primary" size="large" loading={loading} disabled={loading} onClick={handleSave}>
        {editAppId ? t('linkEditor.saveUpdate') : t('linkEditor.create')}
      </Button>
    </div>
  );
};

export default LinkEditor;
