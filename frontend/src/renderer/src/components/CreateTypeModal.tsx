/**
 * 创建类型选择弹窗
 * 选择创建 应用 / AI 技能 / 提示词
 */

import React from 'react';
import { Modal, theme } from 'antd';
import {
  AppstoreOutlined,
  ThunderboltOutlined,
  FileTextOutlined
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useT } from '../i18n';

interface CreateTypeModalProps {
  open: boolean;
  onClose: () => void;
}

const CreateTypeModal: React.FC<CreateTypeModalProps> = ({ open, onClose }) => {
  const navigate = useNavigate();
  const { token } = theme.useToken();
  const t = useT();

  const types = [
    {
      key: 'app',
      icon: <AppstoreOutlined style={{ fontSize: 32 }} />,
      title: t('createType.app'),
      description: t('createType.appDesc'),
      route: '/developer/new'
    },
    {
      key: 'ai-skill',
      icon: <ThunderboltOutlined style={{ fontSize: 32 }} />,
      title: t('createType.skill'),
      description: t('createType.skillDesc'),
      route: '/developer/new-skill'
    },
    {
      key: 'prompt',
      icon: <FileTextOutlined style={{ fontSize: 32 }} />,
      title: t('createType.prompt'),
      description: t('createType.promptDesc'),
      route: '/developer/new-prompt'
    }
  ];

  const handleSelect = (route: string) => {
    onClose();
    navigate(route);
  };

  return (
    <Modal
      title={t('createType.title')}
      open={open}
      onCancel={onClose}
      footer={null}
      width={560}
    >
      <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
        {types.map((item) => (
          <div
            key={item.key}
            onClick={() => handleSelect(item.route)}
            style={{
              flex: 1,
              padding: 20,
              borderRadius: 8,
              border: `1px solid ${token.colorBorderSecondary}`,
              cursor: 'pointer',
              textAlign: 'center',
              transition: 'all 0.2s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = token.colorPrimary;
              e.currentTarget.style.background = token.colorBgTextHover;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = token.colorBorderSecondary;
              e.currentTarget.style.background = 'transparent';
            }}
          >
            <div style={{ color: token.colorPrimary, marginBottom: 12 }}>
              {item.icon}
            </div>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>{item.title}</div>
            <div style={{ fontSize: 12, color: token.colorTextSecondary, lineHeight: '18px' }}>
              {item.description}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
};

export default CreateTypeModal;
