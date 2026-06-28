import React, { useState } from 'react';
import { Button, Modal, Typography, message } from 'antd';
import { DownloadOutlined, AppleOutlined, WindowsOutlined } from '@ant-design/icons';
import { useApi } from '../hooks/useApi';
import type { LatestRelease } from '../types';

const { Text, Title } = Typography;

interface Props {
  appId: string;
  appName: string;
  type?: 'primary' | 'default' | 'text';
  size?: 'small' | 'middle' | 'large';
}

const InstallButton: React.FC<Props> = ({ appId, appName, type = 'primary', size = 'middle' }) => {
  const [showFallback, setShowFallback] = useState(false);
  const [release, setRelease] = useState<LatestRelease | null>(null);
  const [loadingRelease, setLoadingRelease] = useState(false);
  const { fetchApi } = useApi();

  const APP_STORE_URL = typeof window !== 'undefined'
    ? `${window.location.protocol}//${window.location.host}/store`
    : '/store';

  const handleInstall = () => {
    const protocolUrl = `clawbench://install/${encodeURIComponent(appId)}?name=${encodeURIComponent(appName)}`;
    // Try opening the protocol handler
    try {
      window.location.href = protocolUrl;
    } catch {
      // Fallback: try window.open
      window.open(protocolUrl, '_blank');
    }

    // After 2 seconds, check if we're still on the page
    const timer = setTimeout(() => {
      setShowFallback(true);
      loadReleaseInfo();
    }, 2000);

    // If the page blurs (user switched to app), clear the timer
    const onBlur = () => {
      clearTimeout(timer);
      window.removeEventListener('blur', onBlur);
    };
    window.addEventListener('blur', onBlur);
  };

  const loadReleaseInfo = async () => {
    setLoadingRelease(true);
    try {
      const res = await fetchApi<{ success: boolean; data: LatestRelease }>('/api/v1/releases/latest');
      setRelease(res.data);
    } catch {
      // Release info not available
    } finally {
      setLoadingRelease(false);
    }
  };

  return (
    <>
      <Button
        type={type}
        size={size}
        icon={<DownloadOutlined />}
        onClick={handleInstall}
        className={type === 'primary' ? 'ios-install-btn' : ''}
        style={type !== 'primary' ? undefined : {
          height: size === 'large' ? 48 : undefined,
          paddingLeft: size === 'large' ? 32 : undefined,
          paddingRight: size === 'large' ? 32 : undefined,
          fontSize: size === 'large' ? 16 : undefined,
        }}
      >
        Install
      </Button>

      <Modal
        title="Desktop Client Required"
        open={showFallback}
        onCancel={() => setShowFallback(false)}
        footer={null}
        width={480}
      >
        <div style={{ textAlign: 'center', padding: '16px 0' }}>
          <Text type="secondary" style={{ display: 'block', marginBottom: 24 }}>
            ClawBench desktop client was not detected. Install the client first, then try again.
          </Text>

          {loadingRelease ? (
            <Text type="secondary">Loading download options...</Text>
          ) : release ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Text strong>Latest version: {release.version || 'Unknown'}</Text>
              <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
                {release.latest.mac && (
                  <Button
                    type="primary"
                    icon={<AppleOutlined />}
                    size="large"
                    href={release.latest.mac.url}
                    target="_blank"
                  >
                    Download for Mac
                  </Button>
                )}
                {release.latest.windows && (
                  <Button
                    type="primary"
                    icon={<WindowsOutlined />}
                    size="large"
                    href={release.latest.windows.url}
                    target="_blank"
                  >
                    Download for Windows
                  </Button>
                )}
              </div>
              {!release.latest.mac && !release.latest.windows && (
                <Text type="secondary">No downloads available yet.</Text>
              )}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Text type="secondary">No release information available.</Text>
              <Button
                type="primary"
                size="large"
                href={`${APP_STORE_URL}`}
                target="_blank"
              >
                Visit Download Page
              </Button>
            </div>
          )}

          <div style={{ marginTop: 24, padding: 12, background: 'var(--glass-surface-bg)', borderRadius: 12 }}>
            <Text type="secondary" style={{ fontSize: 13 }}>
              After installing, click <Text strong style={{ color: 'var(--ios-accent)' }}>Install</Text> again to add <Text strong>{appName}</Text> to your workspace.
            </Text>
          </div>
        </div>
      </Modal>
    </>
  );
};

export default InstallButton;
