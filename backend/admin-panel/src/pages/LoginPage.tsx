import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Input, Button, App, Divider } from 'antd';
import { UserOutlined, LockOutlined } from '@ant-design/icons';
import { useApi } from '../hooks/useApi';

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
    const apiBase = window.location.origin;
    window.location.href = `${apiBase}/api/v1/auth/feishu?source=web`;
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">C</div>
        <h1>ClawBench Admin</h1>
        <p className="login-sub">Sign in to manage the platform</p>

        <Button
          size="large"
          loading={feishuLoading}
          onClick={handleFeishuLogin}
          block
          style={{
            height: 44,
            fontWeight: 600,
            background: '#3370FF',
            border: 'none',
            color: '#fff',
            marginBottom: 4,
          }}
          icon={
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" style={{ marginRight: 6 }}>
              <path
                d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2z"
                fill="#3370FF"
              />
              <path d="M7.5 8.5h3.5v7H7.5v-7zm5.5 0h3.5v4H13v-4z" fill="#fff" />
            </svg>
          }
        >
          Login with Feishu
        </Button>

        <Divider plain style={{ margin: '16px 0', fontSize: 12, color: 'var(--text-tertiary)' }}>
          or password
        </Divider>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Input
            size="large"
            prefix={<UserOutlined style={{ color: 'var(--text-tertiary)' }} />}
            placeholder="Email or username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onPressEnter={handleSubmit}
          />
          <Input.Password
            size="large"
            prefix={<LockOutlined style={{ color: 'var(--text-tertiary)' }} />}
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onPressEnter={handleSubmit}
          />
          <Button
            type="primary"
            size="large"
            loading={loading}
            onClick={handleSubmit}
            style={{ height: 44, fontWeight: 600, marginTop: 4 }}
            block
          >
            Sign In
          </Button>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
