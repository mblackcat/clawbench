/**
 * Skill 编辑器
 * 创建/编辑 AI 技能（SKILL.md + 可选 scripts/）
 */

import React, { useState, useEffect } from 'react';
import { Typography, Input, Button, Steps, App, theme } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../../stores/useAuthStore';
import { useT } from '../../i18n';

const { Title, Text } = Typography;
const { TextArea } = Input;

const buildSkillTemplate = (name?: string, description?: string): string => {
  const n = name?.trim() || '';
  // Generate slug: English/numbers only, spaces/special chars → hyphen
  const slug = n
    ? n.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'my-skill'
    : 'my-skill';
  const d = description?.trim() || '描述这个技能的用途';
  return `---
name: ${slug}
description: ${d}
---

在这里编写技能的详细 prompt 内容。

部署后可在 AI 编码工具中通过 /${slug} 调用执行。
`;
};

interface SkillForm {
  name: string;
  description: string;
  version: string;
  skillContent: string;
}

const SkillEditor: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { token } = theme.useToken();
  const { message } = App.useApp();
  const user = useAuthStore((state) => state.user);
  const t = useT();

  const editAppId = (location.state as any)?.appId;
  const [currentStep, setCurrentStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState<SkillForm>({
    name: '',
    description: '',
    version: '1.0.0',
    skillContent: buildSkillTemplate(),
  });
  const [contentEdited, setContentEdited] = useState(false);

  useEffect(() => {
    if (editAppId) {
      loadExistingSkill(editAppId);
    }
  }, [editAppId]);

  const loadExistingSkill = async (appId: string) => {
    try {
      const appPath = await window.api.developer.getAppPath(appId);
      const manifestStr = await window.api.developer.readFile(`${appPath}/manifest.json`);
      const manifest = JSON.parse(manifestStr);

      setForm({
        name: manifest.name || '',
        description: manifest.description || '',
        version: manifest.version || '1.0.0',
        skillContent: buildSkillTemplate(manifest.name, manifest.description),
      });
      setContentEdited(true); // existing skill, don't auto-regenerate

      try {
        const skillMd = await window.api.developer.readFile(`${appPath}/SKILL.md`);
        setForm(prev => ({ ...prev, skillContent: skillMd }));
      } catch {
        // SKILL.md may not exist yet
      }
    } catch (error) {
      console.error('Failed to load skill:', error);
      message.error('加载技能失败');
    }
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      message.error('请输入技能名称');
      return;
    }

    setLoading(true);
    try {
      const manifest = {
        id: editAppId || `${crypto.randomUUID().slice(0, 8)}-skill`,
        name: form.name.trim(),
        version: form.version.trim() || '1.0.0',
        description: form.description.trim(),
        type: 'ai-skill' as const,
        entry: 'SKILL.md',
        author: user ? { name: user.username, feishu_id: (user as any).feishu_id || '' } : 'unknown',
      };

      if (editAppId) {
        await window.api.developer.updateApp(editAppId, manifest);
        const appPath = await window.api.developer.getAppPath(editAppId);
        await window.api.developer.writeFile(`${appPath}/SKILL.md`, form.skillContent);
        message.success('技能已更新');
      } else {
        const appPath = await window.api.developer.createApp(manifest);
        await window.api.developer.writeFile(`${appPath}/SKILL.md`, form.skillContent);
        message.success('技能已创建');
      }

      navigate('/apps/my-contributions');
    } catch (error) {
      console.error('Failed to save skill:', error);
      message.error('保存技能失败');
    } finally {
      setLoading(false);
    }
  };

  const handleNext = () => {
    // When moving from Step 1 → Step 2, regenerate template if user hasn't manually edited
    if (currentStep === 0 && !contentEdited) {
      setForm(prev => ({ ...prev, skillContent: buildSkillTemplate(prev.name, prev.description) }));
    }
    setCurrentStep(currentStep + 1);
  };

  const steps = [
    { title: '基本信息' },
    { title: 'SKILL.md' },
    { title: '保存' },
  ];

  const renderStep = () => {
    switch (currentStep) {
      case 0:
        return (
          <div style={{ maxWidth: 600 }}>
            <div style={{ marginBottom: 16 }}>
              <Text strong>技能名称 *</Text>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="例如：代码审查助手"
                style={{ marginTop: 8 }}
              />
            </div>
            <div style={{ marginBottom: 16 }}>
              <Text strong>描述</Text>
              <TextArea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="简要描述这个技能的用途"
                rows={3}
                style={{ marginTop: 8 }}
              />
            </div>
            <div style={{ marginBottom: 16 }}>
              <Text strong>版本</Text>
              <Input
                value={form.version}
                onChange={(e) => setForm({ ...form, version: e.target.value })}
                placeholder="1.0.0"
                style={{ marginTop: 8 }}
              />
            </div>
          </div>
        );
      case 1:
        return (
          <div>
            <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
              编辑 SKILL.md — 这是技能的核心定义文件，将被部署到 AI 编码工具的 commands 目录中。
            </Text>
            <TextArea
              value={form.skillContent}
              onChange={(e) => {
                setForm({ ...form, skillContent: e.target.value });
                setContentEdited(true);
              }}
              rows={20}
              style={{
                fontFamily: 'monospace',
                fontSize: 13,
              }}
            />
          </div>
        );
      case 2:
        return (
          <div style={{
            padding: 24,
            borderRadius: 8,
            border: `1px solid ${token.colorBorderSecondary}`,
            background: token.colorBgLayout,
          }}>
            <Title level={5}>确认信息</Title>
            <div style={{ marginBottom: 8 }}><Text strong>名称：</Text>{form.name}</div>
            <div style={{ marginBottom: 8 }}><Text strong>版本：</Text>{form.version}</div>
            <div style={{ marginBottom: 8 }}><Text strong>描述：</Text>{form.description || '(无)'}</div>
            <div style={{ marginBottom: 8 }}><Text strong>SKILL.md：</Text>{form.skillContent.length} 字符</div>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div style={{ padding: 24 }}>
      <div style={{ marginBottom: 24, display: 'flex', alignItems: 'center', gap: 12 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/apps/my-contributions')}>
          {t('common.back')}
        </Button>
        <Title level={4} style={{ margin: 0 }}>
          {editAppId ? '编辑 AI 技能' : '创建 AI 技能'}
        </Title>
      </div>

      <Steps current={currentStep} items={steps} style={{ marginBottom: 32, maxWidth: 500 }} />

      {renderStep()}

      <div style={{ marginTop: 24, display: 'flex', gap: 8 }}>
        {currentStep > 0 && (
          <Button onClick={() => setCurrentStep(currentStep - 1)}>上一步</Button>
        )}
        {currentStep < steps.length - 1 ? (
          <Button type="primary" onClick={handleNext}>
            下一步
          </Button>
        ) : (
          <Button type="primary" loading={loading} onClick={handleSave}>
            {editAppId ? '保存更新' : '创建技能'}
          </Button>
        )}
      </div>
    </div>
  );
};

export default SkillEditor;
