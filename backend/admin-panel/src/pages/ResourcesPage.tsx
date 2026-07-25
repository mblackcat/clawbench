import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Tabs } from 'antd';
import ResourceListPage from './ResourceListPage';
import type { ApplicationType } from '../types';
import { TYPE_LABELS } from '../types';

/**
 * Resources hub for the non-app marketplace types (AI Skill / Prompt / Link).
 *
 * Each tab embeds a type-locked ResourceListPage. The active tab is also
 * reflected in the `?type=` query string so dashboard deep-links
 * (e.g. `/admin/resources?type=link`) land on the right tab, and the URL
 * updates when the user switches tabs.
 */
const RESOURCE_TABS: ApplicationType[] = ['ai-skill', 'prompt', 'link'];

const ResourcesPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const initial = searchParams.get('type');
  const validInitial =
    initial && (RESOURCE_TABS as string[]).includes(initial)
      ? (initial as ApplicationType)
      : 'ai-skill';
  const [activeTab, setActiveTab] = useState<ApplicationType>(validInitial);

  useEffect(() => {
    const t = searchParams.get('type');
    if (t && (RESOURCE_TABS as string[]).includes(t) && t !== activeTab) {
      setActiveTab(t as ApplicationType);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const handleTabChange = (key: string) => {
    setActiveTab(key as ApplicationType);
    setSearchParams({ type: key }, { replace: true });
  };

  const tabItems = RESOURCE_TABS.map((type) => ({
    key: type,
    label: `${TYPE_LABELS[type]}s`,
    children: <ResourceListPage fixedType={type} hidePageHeader />,
  }));

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Resources</h1>
          <p className="page-desc">
            Manage AI skills, prompts, and links — feature, publish, covers, and error logs.
          </p>
        </div>
      </div>

      <Tabs
        activeKey={activeTab}
        onChange={handleTabChange}
        items={tabItems}
        tabBarStyle={{ marginBottom: 16 }}
      />
    </div>
  );
};

export default ResourcesPage;
