import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Input, Button, Typography, App } from 'antd';
import { UserOutlined, LockOutlined } from '@ant-design/icons';
import { useApi } from '../hooks/useApi';

const { Title, Text } = Typography;

const LoginPage: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
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
