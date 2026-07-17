/**
 * Prompt 编辑器
 * 创建/编辑提示词 — 简单文本输入
 */

import React, { useState, useEffect, useRef } from 'react';
import { Typography, Input, Button, App, theme } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../../stores/useAuthStore';
import { useT } from '../../i18n';
import { MONO_FONT_STACK } from '../../utils/mono-font';

const { Title, Text } = Typography;
const { TextArea } = Input;

const PromptEditor: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { token } = theme.useToken();
  const { message } = App.useApp();
  const user = useAuthStore((state) => state.user);
  const t = useT();

  const editAppId = (location.state as any)?.appId;
  const fromPath = (location.state as any)?.from as string | undefined;
  const backTarget = fromPath || '/workbench/my-contributions';
  const savingRef = useRef(false);
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [version, setVersion] = useState('1.0.0');
  const [icon, setIcon] = useState('');
  const [promptContent, setPromptContent] = useState('');

  useEffect(() => {
    if (editAppId) {
      loadExistingPrompt(editAppId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editAppId]);

  const loadExistingPrompt = async (appId: string) => {
    try {
      const appPath = await window.api.developer.getAppPath(appId);
      const manifestStr = await window.api.developer.readFile(`${appPath}/manifest.json`);
      const manifest = JSON.parse(manifestStr);

      setName(manifest.name || '');
      setDescription(manifest.description || '');
      setVersion(manifest.version || '1.0.0');
      setIcon(manifest.icon || '');

      try {
        const content = await window.api.developer.readFile(`${appPath}/prompt.md`);
        setPromptContent(content);
      } catch {
        // prompt.md may not exist yet
      }
    } catch (error) {
      console.error('Failed to load prompt:', error);
      message.error(t('promptEditor.loadFailed'));
    }
  };

  const handleSave = async () => {
    if (!name.trim()) {
      message.error(t('promptEditor.nameRequired'));
      return;
    }
    if (!promptContent.trim()) {
      message.error(t('promptEditor.contentRequired'));
      return;
    }

    if (savingRef.current) return;
    savingRef.current = true;
    setLoading(true);
    try {
      const iconVal = icon.trim();
      const manifest = {
        id: editAppId || `${crypto.randomUUID().slice(0, 8)}-prompt`,
        name: name.trim(),
        version: version.trim() || '1.0.0',
        description: description.trim(),
        type: 'prompt' as const,
        entry: 'prompt.md',
        ...(iconVal ? { icon: iconVal } : {}),
        author: user ? { name: user.username, feishu_id: (user as any).feishu_id || '' } : 'unknown',
      };

      if (editAppId) {
        await window.api.developer.updateApp(editAppId, manifest);
        const appPath = await window.api.developer.getAppPath(editAppId);
        await window.api.developer.writeFile(`${appPath}/prompt.md`, promptContent);
        message.success(t('promptEditor.promptUpdated'));
      } else {
        const appPath = await window.api.developer.createApp(manifest);
        await window.api.developer.writeFile(`${appPath}/prompt.md`, promptContent);
        message.success(t('promptEditor.promptCreated'));
      }

      navigate(backTarget);
    } catch (error) {
      console.error('Failed to save prompt:', error);
      message.error(t('promptEditor.saveFailed'));
    } finally {
      setLoading(false);
      savingRef.current = false;
    }
  };

  return (
    <div style={{ padding: 24, maxWidth: 800 }}>
      <div style={{ marginBottom: 24, display: 'flex', alignItems: 'center', gap: 12 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(backTarget)}>
          {t('common.back')}
        </Button>
        <Title level={4} style={{ margin: 0 }}>
          {editAppId ? t('promptEditor.editTitle') : t('promptEditor.createTitle')}
        </Title>
      </div>

      <div style={{ marginBottom: 16 }}>
        <Text strong>{t('promptEditor.name')}</Text>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('promptEditor.namePlaceholder')}
          style={{ marginTop: 8 }}
        />
      </div>

      <div style={{ marginBottom: 16 }}>
        <Text strong>{t('promptEditor.description')}</Text>
        <Input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t('promptEditor.descPlaceholder')}
          style={{ marginTop: 8 }}
        />
      </div>

      <div style={{ marginBottom: 16 }}>
        <Text strong>{t('promptEditor.version')}</Text>
        <Input
          value={version}
          onChange={(e) => setVersion(e.target.value)}
          placeholder="1.0.0"
          style={{ marginTop: 8, maxWidth: 200 }}
        />
      </div>

      <div style={{ marginBottom: 16 }}>
        <Text strong>{t('promptEditor.cover')}</Text>
        <Input
          value={icon}
          onChange={(e) => setIcon(e.target.value)}
          placeholder={t('promptEditor.coverPlaceholder')}
          style={{ marginTop: 8 }}
        />
        <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 4 }}>
          {t('promptEditor.coverHelp')}
        </Text>
      </div>

      <div style={{ marginBottom: 24 }}>
        <Text strong>{t('promptEditor.content')}</Text>
        <TextArea
          value={promptContent}
          onChange={(e) => setPromptContent(e.target.value)}
          placeholder={t('promptEditor.contentPlaceholder')}
          rows={15}
          style={{ marginTop: 8, fontFamily: MONO_FONT_STACK, fontSize: 13 }}
        />
      </div>

      <Button type="primary" size="large" loading={loading} disabled={loading} onClick={handleSave}>
        {editAppId ? t('promptEditor.saveUpdate') : t('promptEditor.create')}
      </Button>
    </div>
  );
};

export default PromptEditor;
