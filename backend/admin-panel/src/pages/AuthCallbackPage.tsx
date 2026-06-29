import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Typography, Spin } from 'antd';
import { CheckCircleOutlined, CloseCircleOutlined } from '@ant-design/icons';

const { Title, Text } = Typography;

/**
 * Receives Feishu OAuth callback from backend.
 * URL: /admin/auth/callback?token=JWT&userId=xxx&feishuAccessToken=xxx
 * Stores JWT in localStorage and redirects to dashboard.
 */
const AuthCallbackPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = searchParams.get('token');
    const userId = searchParams.get('userId');

    if (token) {
      // Store tokens in localStorage
      localStorage.setItem('admin_token', token);
      if (userId) localStorage.setItem('admin_userId', userId);

      const feishuAccessToken = searchParams.get('feishuAccessToken');
      if (feishuAccessToken) localStorage.setItem('feishu_access_token', feishuAccessToken);

      // Redirect to dashboard after a brief moment
      const timer = setTimeout(() => {
        navigate('/admin/dashboard', { replace: true });
      }, 800);
      return () => clearTimeout(timer);
    } else {
      setError(searchParams.get('message') || 'No token received from authentication');
    }
  }, [searchParams, navigate]);

  if (error) {
    return (
      <div className="ios-login-container">
        <div className="ios-glass-elevated" style={{ padding: 48, textAlign: 'center', maxWidth: 420 }}>
          <CloseCircleOutlined style={{ fontSize: 48, color: '#FF3B30', marginBottom: 16 }} />
          <Title level={4} style={{ marginBottom: 8 }}>Login Failed</Title>
          <Text type="secondary">{error}</Text>
        </div>
      </div>
    );
  }

  return (
    <div className="ios-login-container">
      <div className="ios-glass-elevated" style={{ padding: 48, textAlign: 'center', maxWidth: 420 }}>
        <CheckCircleOutlined style={{ fontSize: 48, color: '#34C759', marginBottom: 16 }} />
        <Title level={4} style={{ marginBottom: 8 }}>Login Successful</Title>
        <Text type="secondary">Redirecting to dashboard...</Text>
        <div style={{ marginTop: 24 }}>
          <Spin size="default" />
        </div>
      </div>
    </div>
  );
};

export default AuthCallbackPage;
