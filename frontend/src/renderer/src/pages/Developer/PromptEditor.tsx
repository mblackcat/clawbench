/**
 * Prompt 编辑器
 * 创建/编辑提示词 — 简单文本输入
 */

import React, { useState, useEffect } from 'react';
import { Typography, Input, Button, App, theme } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../../stores/useAuthStore';
import { useT } from '../../i18n';

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
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [version, setVersion] = useState('1.0.0');
  const [promptContent, setPromptContent] = useState('');

  useEffect(() => {
    if (editAppId) {
      loadExistingPrompt(editAppId);
    }
  }, [editAppId]);

  const loadExistingPrompt = async (appId: string) => {
    try {
      const appPath = await window.api.developer.getAppPath(appId);
      const manifestStr = await window.api.developer.readFile(`${appPath}/manifest.json`);
      const manifest = JSON.parse(manifestStr);

      setName(manifest.name || '');
      setDescription(manifest.description || '');
      setVersion(manifest.version || '1.0.0');

      try {
        const content = await window.api.developer.readFile(`${appPath}/prompt.md`);
        setPromptContent(content);
      } catch {
        // prompt.md may not exist yet
      }
    } catch (error) {
      console.error('Failed to load prompt:', error);
      message.error('加载提示词失败');
    }
  };

  const handleSave = async () => {
    if (!name.trim()) {
      message.error('请输入提示词名称');
      return;
    }
    if (!promptContent.trim()) {
      message.error('请输入提示词内容');
      return;
    }

    setLoading(true);
    try {
      const manifest = {
        id: editAppId || `${crypto.randomUUID().slice(0, 8)}-prompt`,
        name: name.trim(),
        version: version.trim() || '1.0.0',
        description: description.trim(),
        type: 'prompt' as const,
        entry: 'prompt.md',
        author: user ? { name: user.username, feishu_id: (user as any).feishu_id || '' } : 'unknown',
      };

      if (editAppId) {
        await window.api.developer.updateApp(editAppId, manifest);
        const appPath = await window.api.developer.getAppPath(editAppId);
        await window.api.developer.writeFile(`${appPath}/prompt.md`, promptContent);
        message.success('提示词已更新');
      } else {
        const appPath = await window.api.developer.createApp(manifest);
        await window.api.developer.writeFile(`${appPath}/prompt.md`, promptContent);
        message.success('提示词已创建');
      }

      navigate('/apps/my-contributions');
    } catch (error) {
      console.error('Failed to save prompt:', error);
      message.error('保存提示词失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: 24, maxWidth: 800 }}>
      <div style={{ marginBottom: 24, display: 'flex', alignItems: 'center', gap: 12 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/apps/my-contributions')}>
          {t('common.back')}
        </Button>
        <Title level={4} style={{ margin: 0 }}>
          {editAppId ? '编辑提示词' : '创建提示词'}
        </Title>
      </div>

      <div style={{ marginBottom: 16 }}>
        <Text strong>名称 *</Text>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="给这个提示词起个名字"
          style={{ marginTop: 8 }}
        />
      </div>

      <div style={{ marginBottom: 16 }}>
        <Text strong>描述</Text>
        <Input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="简要描述用途"
          style={{ marginTop: 8 }}
        />
      </div>

      <div style={{ marginBottom: 16 }}>
        <Text strong>版本</Text>
        <Input
          value={version}
          onChange={(e) => setVersion(e.target.value)}
          placeholder="1.0.0"
          style={{ marginTop: 8, maxWidth: 200 }}
        />
      </div>

      <div style={{ marginBottom: 24 }}>
        <Text strong>提示词内容 *</Text>
        <TextArea
          value={promptContent}
          onChange={(e) => setPromptContent(e.target.value)}
          placeholder="输入你的 Prompt 文本..."
          rows={15}
          style={{ marginTop: 8, fontFamily: 'monospace', fontSize: 13 }}
        />
      </div>

      <Button type="primary" size="large" loading={loading} onClick={handleSave}>
        {editAppId ? '保存更新' : '创建提示词'}
      </Button>
    </div>
  );
};

export default PromptEditor;
