import React, { useEffect, useState, useCallback } from 'react';
import { Table, Select, Button, Popconfirm, Typography, App, Tag } from 'antd';
import { DeleteOutlined, ReloadOutlined } from '@ant-design/icons';
import { useApi } from '../hooks/useApi';
import SearchBar from '../components/SearchBar';
import type { UserResponse, ApiResponse, PaginatedData } from '../types';

const { Title, Text } = Typography;

const UserManagementPage: React.FC = () => {
  const [users, setUsers] = useState<UserResponse[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const { fetchApi } = useApi();
  const { message } = App.useApp();

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set('search', search.trim());
      params.set('limit', String(pageSize));
      params.set('offset', String((page - 1) * pageSize));

      const res = await fetchApi<{ success: boolean; data: { users: UserResponse[]; total: number } }>(
        `/api/v1/admin/users?${params.toString()}`
      );
      setUsers(res.data.users);
      setTotal(res.data.total);
    } catch (err: any) {
      message.error(err.message || 'Failed to load users');
    } finally {
      setLoading(false);
    }
  }, [search, page, pageSize, fetchApi, message]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const handleRoleChange = async (userId: string, role: 'admin' | 'user') => {
    try {
      await fetchApi(`/api/v1/admin/users/${userId}`, {
        method: 'PUT',
        body: JSON.stringify({ role }),
      });
      message.success(`User role updated to ${role}`);
      loadUsers();
    } catch (err: any) {
      message.error(err.message || 'Failed to update role');
    }
  };

  const handleDelete = async (userId: string) => {
    try {
      await fetchApi(`/api/v1/admin/users/${userId}`, { method: 'DELETE' });
      message.success('User deleted');
      loadUsers();
    } catch (err: any) {
      message.error(err.message || 'Failed to delete user');
    }
  };

  const columns = [
    {
      title: 'Username',
      dataIndex: 'username',
      key: 'username',
      render: (text: string) => <Text strong>{text}</Text>,
    },
    {
      title: 'Email',
      dataIndex: 'email',
      key: 'email',
      render: (text?: string) => text || <Text type="secondary">—</Text>,
    },
    {
      title: 'Role',
      dataIndex: 'role',
      key: 'role',
      render: (role: string, record: UserResponse) => (
        <Select
          value={role as 'admin' | 'user'}
          onChange={(v: 'admin' | 'user') => handleRoleChange(record.userId, v)}
          style={{ width: 100 }}
          options={[
            { value: 'user', label: 'User' },
            { value: 'admin', label: 'Admin' },
          ]}
        />
      ),
    },
    {
      title: 'Auth',
      dataIndex: 'authProvider',
      key: 'authProvider',
      width: 100,
      render: (text?: string) => (
        <Tag color={text === 'feishu' ? 'blue' : 'default'}>
          {text || 'local'}
        </Tag>
      ),
    },
    {
      title: 'Created',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 180,
      render: (ts: number) => new Date(ts).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      }),
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 80,
      render: (_: unknown, record: UserResponse) => (
        <Popconfirm
          title="Delete this user?"
          description="This action cannot be undone."
          onConfirm={() => handleDelete(record.userId)}
          okText="Delete"
          okType="danger"
          cancelText="Cancel"
        >
          <Button type="text" danger icon={<DeleteOutlined />} />
        </Popconfirm>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <Title level={3} style={{ margin: 0, letterSpacing: '-0.02em' }}>
          User Management
        </Title>
        <Button icon={<ReloadOutlined />} onClick={loadUsers}>
          Refresh
        </Button>
      </div>

      <div style={{ marginBottom: 20, maxWidth: 400 }}>
        <SearchBar
          value={search}
          onChange={(v) => { setSearch(v); setPage(1); }}
          placeholder="Search by username or email..."
        />
      </div>

      <div className="ios-table-container">
        <Table
          columns={columns}
          dataSource={users}
          rowKey="userId"
          loading={loading}
          pagination={{
            current: page,
            pageSize,
            total,
            onChange: setPage,
            showTotal: (t) => `${t} users`,
          }}
        />
      </div>
    </div>
  );
};

export default UserManagementPage;
