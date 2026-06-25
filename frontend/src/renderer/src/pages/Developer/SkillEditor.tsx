/**
 * Skill 编辑器
 * 创建/编辑 AI 技能（SKILL.md + 可选 scripts/）
 */

import React, { useState, useEffect, useRef } from 'react';
import { Typography, Input, Button, Steps, App, theme } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../../stores/useAuthStore';
import { useT, type TFunction } from '../../i18n';

const { Title, Text } = Typography;
const { TextArea } = Input;

const buildSkillTemplate = (t: TFunction, name?: string, description?: string): string => {
  const n = name?.trim() || '';
  // Generate slug: English/numbers only, spaces/special chars → hyphen
  const slug = n
    ? n.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'my-skill'
    : 'my-skill';
  const d = description?.trim() || t('skillEditor.templateDesc');
  return `---
name: ${slug}
description: ${d}
---

${t('skillEditor.templateBody')}

${t('skillEditor.templateUsage', slug)}
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
  const fromPath = (location.state as any)?.from as string | undefined;
  const backTarget = fromPath || '/apps/my-contributions';
  const savingRef = useRef(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState<SkillForm>({
    name: '',
    description: '',
    version: '1.0.0',
    skillContent: buildSkillTemplate(t),
  });
  const [contentEdited, setContentEdited] = useState(false);

  useEffect(() => {
    if (editAppId) {
      loadExistingSkill(editAppId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        skillContent: buildSkillTemplate(t, manifest.name, manifest.description),
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
      message.error(t('skillEditor.loadFailed'));
    }
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      message.error(t('skillEditor.nameRequired'));
      return;
    }

    if (savingRef.current) return;
    savingRef.current = true;
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
        message.success(t('skillEditor.skillUpdated'));
      } else {
        const appPath = await window.api.developer.createApp(manifest);
        await window.api.developer.writeFile(`${appPath}/SKILL.md`, form.skillContent);
        message.success(t('skillEditor.skillCreated'));
      }

      navigate('/apps/my-contributions');
    } catch (error) {
      console.error('Failed to save skill:', error);
      message.error(t('skillEditor.saveFailed'));
    } finally {
      setLoading(false);
      savingRef.current = false;
    }
  };

  const handleNext = () => {
    // When moving from Step 1 → Step 2, regenerate template if user hasn't manually edited
    if (currentStep === 0 && !contentEdited) {
      setForm(prev => ({ ...prev, skillContent: buildSkillTemplate(t, prev.name, prev.description) }));
    }
    setCurrentStep(currentStep + 1);
  };

  const steps = [
    { title: t('skillEditor.stepBasicInfo') },
    { title: t('skillEditor.stepContent') },
    { title: t('skillEditor.stepSave') },
  ];

  const renderStep = () => {
    switch (currentStep) {
      case 0:
        return (
          <div style={{ maxWidth: 600 }}>
            <div style={{ marginBottom: 16 }}>
              <Text strong>{t('skillEditor.name')}</Text>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder={t('skillEditor.namePlaceholder')}
                style={{ marginTop: 8 }}
              />
            </div>
            <div style={{ marginBottom: 16 }}>
              <Text strong>{t('skillEditor.description')}</Text>
              <TextArea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder={t('skillEditor.descPlaceholder')}
                rows={3}
                style={{ marginTop: 8 }}
              />
            </div>
            <div style={{ marginBottom: 16 }}>
              <Text strong>{t('skillEditor.version')}</Text>
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
              {t('skillEditor.contentHint')}
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
            <Title level={5}>{t('skillEditor.confirmTitle')}</Title>
            <div style={{ marginBottom: 8 }}><Text strong>{t('skillEditor.confirmName')}</Text>{form.name}</div>
            <div style={{ marginBottom: 8 }}><Text strong>{t('skillEditor.confirmVersion')}</Text>{form.version}</div>
            <div style={{ marginBottom: 8 }}><Text strong>{t('skillEditor.confirmDesc')}</Text>{form.description || t('skillEditor.confirmEmpty')}</div>
            <div style={{ marginBottom: 8 }}><Text strong>{t('skillEditor.confirmContent')}</Text>{form.skillContent.length} {t('skillEditor.charsUnit')}</div>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div style={{ padding: 24 }}>
      <div style={{ marginBottom: 24, display: 'flex', alignItems: 'center', gap: 12 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(backTarget)}>
          {t('common.back')}
        </Button>
        <Title level={4} style={{ margin: 0 }}>
          {editAppId ? t('skillEditor.editTitle') : t('skillEditor.createTitle')}
        </Title>
      </div>

      <Steps current={currentStep} items={steps} style={{ marginBottom: 32, maxWidth: 500 }} />

      {renderStep()}

      <div style={{ marginTop: 24, display: 'flex', gap: 8 }}>
        {currentStep > 0 && (
          <Button onClick={() => setCurrentStep(currentStep - 1)}>{t('skillEditor.prev')}</Button>
        )}
        {currentStep < steps.length - 1 ? (
          <Button type="primary" onClick={handleNext}>
            {t('skillEditor.next')}
          </Button>
        ) : (
          <Button type="primary" loading={loading} disabled={loading} onClick={handleSave}>
            {editAppId ? t('skillEditor.saveUpdate') : t('skillEditor.create')}
          </Button>
        )}
      </div>
    </div>
  );
};

export default SkillEditor;
