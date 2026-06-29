import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Input, Button, Typography, App, Divider } from 'antd';
import { UserOutlined, LockOutlined } from '@ant-design/icons';
import { useApi } from '../hooks/useApi';

const { Title, Text } = Typography;

const LoginPage: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [feishuLoading, setFeishuLoading] = useState(false);
  const { login } = useApi();
  const navigate = useNavigate();
  const { message } = App.useApp();

  const handleSubmit = async () => {
    if (!email.trim() || !password) {
      message.error('Please enter email and password');
      return;
    }

    setLoading(true);
    try {
      await login(email.trim(), password);
      message.success('Login successful');
      navigate('/admin/dashboard');
    } catch (err: any) {
      message.error(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const handleFeishuLogin = () => {
    setFeishuLoading(true);
    // Redirect to backend Feishu OAuth with source=web
    // The backend will redirect back to /admin/auth/callback after auth
    const apiBase = window.location.origin;
    window.location.href = `${apiBase}/api/v1/auth/feishu?source=web`;
  };

  return (
    <div className="ios-login-container">
      <div className="ios-glass-elevated ios-login-card">
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 16,
              background: 'linear-gradient(135deg, #007AFF, #AF52DE)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'white',
              fontWeight: 700,
              fontSize: 26,
              marginBottom: 16,
            }}
          >
            C
          </div>
          <Title level={2} style={{ marginBottom: 4, letterSpacing: '-0.02em' }}>
            ClawBench Admin
          </Title>
          <Text type="secondary">Sign in to manage the platform</Text>
        </div>

        {/* 飞书登录按钮 */}
        <Button
          size="large"
          loading={feishuLoading}
          onClick={handleFeishuLogin}
          style={{
            height: 48,
            fontSize: 16,
            fontWeight: 600,
            width: '100%',
            background: 'linear-gradient(135deg, #3370FF, #2860E1)',
            border: 'none',
            color: '#FFFFFF',
            marginBottom: 16,
          }}
          icon={
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" style={{ marginRight: 8 }}>
              <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2z" fill="#3370FF"/>
              <path d="M7.5 8.5h3.5v7H7.5v-7zm5.5 0h3.5v4H13v-4z" fill="#fff"/>
            </svg>
          }
        >
          Login with Feishu
        </Button>

        <Divider plain style={{ margin: '16px 0', color: 'var(--text-tertiary)', fontSize: 12 }}>
          or use password
        </Divider>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Input
            size="large"
            prefix={<UserOutlined style={{ color: 'var(--text-tertiary)' }} />}
            placeholder="Email or Username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onPressEnter={handleSubmit}
            style={{ height: 48 }}
          />
          <Input.Password
            size="large"
            prefix={<LockOutlined style={{ color: 'var(--text-tertiary)' }} />}
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onPressEnter={handleSubmit}
            style={{ height: 48 }}
          />
          <Button
            type="primary"
            size="large"
            loading={loading}
            onClick={handleSubmit}
            style={{ height: 48, fontSize: 16, fontWeight: 600, marginTop: 8 }}
          >
            Sign In
          </Button>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
