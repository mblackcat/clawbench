import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Spin } from 'antd';
import { CheckCircleOutlined, CloseCircleOutlined } from '@ant-design/icons';

const AuthCallbackPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = searchParams.get('token');
    const userId = searchParams.get('userId');

    if (token) {
      localStorage.setItem('admin_token', token);
      if (userId) localStorage.setItem('admin_userId', userId);

      const feishuAccessToken = searchParams.get('feishuAccessToken');
      if (feishuAccessToken) localStorage.setItem('feishu_access_token', feishuAccessToken);

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
      <div className="login-page">
        <div className="login-card" style={{ textAlign: 'center' }}>
          <CloseCircleOutlined style={{ fontSize: 40, color: 'var(--danger)', marginBottom: 12 }} />
          <h1>Login failed</h1>
          <p className="login-sub">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="login-page">
      <div className="login-card" style={{ textAlign: 'center' }}>
        <CheckCircleOutlined style={{ fontSize: 40, color: 'var(--success)', marginBottom: 12 }} />
        <h1>Login successful</h1>
        <p className="login-sub">Redirecting to dashboard…</p>
        <div style={{ marginTop: 20 }}>
          <Spin />
        </div>
      </div>
    </div>
  );
};

export default AuthCallbackPage;
