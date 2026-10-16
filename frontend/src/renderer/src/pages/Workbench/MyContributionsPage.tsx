/**
 * 我的页面
 * 展示用户本地创建的所有 app/skill/prompt
 */

import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { Typography, Tag, Tooltip, theme, Button, App, Tabs, Empty, Checkbox, Spin } from 'antd';
import {
  EditOutlined,
  CloudUploadOutlined,
  ArrowLeftOutlined,
  ExportOutlined,
  CloseOutlined,
  CaretRightOutlined,
  DownloadOutlined
} from '@ant-design/icons';
import { useNavigate, useLocation } from 'react-router-dom';
import { applicationManager } from '../../services/applicationManager';
import type { Application } from '../../types/api';
import { useSubAppStore } from '../../stores/useSubAppStore';
import { useAuthStore, useIsAdmin } from '../../stores/useAuthStore';
import { useSettingsStore } from '../../stores/useSettingsStore';
import type { SubAppManifest } from '../../types/subapp';
import { resolveAppPublished } from '../../types/subapp';
import { openExternalLink } from '../../utils/markdown-links';
import SkillsManager, { type SelfSkill } from '../../components/SkillsManager';
import { useT } from '../../i18n';
import { seedTaskFromExecuteResult, describeEarlyTerminal } from '../../utils/subapp-execute';
import { isAuthoredByCurrentUser } from '../../utils/app-identity';
import { isBuiltinAppId, resolveLocalAppStatus, type AppCardStatus } from '../../utils/app-status';
import { AppVersionTag } from '../../components/AppStatusTag';
import { AppIcon } from '../../components/AppIcon';
import { FolderCard } from '../../components/FolderCard';

const { Title, Text } = Typography;

type MineTabKey = 'app' | 'ai-skill' | 'prompt' | 'link';
const MINE_TAB_STORAGE_KEY = 'mine.activeTab';

const isMineTabKey = (v: unknown): v is MineTabKey =>
  v === 'app' || v === 'ai-skill' || v === 'prompt' || v === 'link';

type AppType = 'draft' | 'local' | 'published';

/**
 * One card on 我的: a local resource (authored by the user, or a builtin for
 * admins) or a server app the user owns that is not on this machine yet.
 */
interface MineItem {
  /** Stable React key */
  key: string
  /** Local folder / manifest id when present on disk */
  localId?: string
  /** Marketplace applicationId when known */
  applicationId?: string
  name: string
  version: string
  /** Server version when known */
  remoteVersion?: string
  description: string
  category: MineTabKey
  /** Local manifest when on disk */
  manifest?: SubAppManifest
  /** Legacy OSS classification (kept for SkillsManager / tags) */
  appType: AppType
  status: AppCardStatus
  hasLocal: boolean
  isBuiltin: boolean
}

const toTabKey = (type: string | undefined): MineTabKey =>
  isMineTabKey(type) ? type : 'app';

const MyContributionsPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { token } = theme.useToken();
  const { message, modal } = App.useApp();
  const t = useT();
  // Back button target. Default to 收藏栏; if the user came from 发现
  // (injected via navigate state), return there instead.
  const backTarget = (location.state as { from?: string } | null)?.from || '/workbench/installed';
  const [mineItems, setMineItems] = useState<MineItem[]>([]);
  /** Published marketplace apps (all owners) — used for published-name healing. */
  const [allApps, setAllApps] = useState<Application[]>([]);
  /** Server apps owned by the current user (published or not). */
  const [ownedServerApps, setOwnedServerApps] = useState<Application[]>([]);
  const [installing, setInstalling] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  // 长按任意一张卡片进入全局"抖动"模式（类似 iOS 桌面图标长按）：本 Tab 下
  // 所有卡片一起抖动，每张卡片左上角浮出一个圆形 X 按钮——已发布的走下架
  // 流程，草稿/本地的走本地文件删除流程，仅云端的走服务端删除。抖动是全局态
  // 而非某张卡片的私有态，所以用一个 boolean 即可。
  const [isJiggleMode, setIsJiggleMode] = useState(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelLongPress = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const startLongPress = () => {
    cancelLongPress();
    longPressTimer.current = setTimeout(() => {
      setIsJiggleMode(true);
    }, 550);
  };

  // 抖动态下，在卡片之外任意位置按下即退出抖动——但要放过 X 按钮自身、以及
  // 二次确认弹窗（modal.confirm 挂载在 document.body 下的 .ant-modal-root，
  // 不在卡片 DOM 内）的按下事件，否则点击"取消"也会连带关闭抖动，或者 X
  // 按钮在它自己的 click 事件触发前就被卸载导致点不动。
  useEffect(() => {
    if (!isJiggleMode) return;
    const closeJiggle = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('.cb-card-close-btn') || target?.closest('.ant-modal-root')) return;
      setIsJiggleMode(false);
    };
    window.addEventListener('pointerdown', closeJiggle);
    return () => window.removeEventListener('pointerdown', closeJiggle);
  }, [isJiggleMode]);

  // Active category tab — restored from localStorage, overridable via navigation state.
  const [activeTab, setActiveTab] = useState<MineTabKey>(() => {
    const stored = localStorage.getItem(MINE_TAB_STORAGE_KEY);
    return isMineTabKey(stored) ? stored : 'app';
  });

  // "下载打开后切换到对应页签" — a caller can navigate here with { state: { tab } }.
  useEffect(() => {
    const hint = (location.state as { tab?: unknown } | null)?.tab;
    if (isMineTabKey(hint)) {
      setActiveTab(hint);
    }
  }, [location.state]);

  const handleTabChange = (key: string) => {
    if (isMineTabKey(key)) {
      setActiveTab(key);
      localStorage.setItem(MINE_TAB_STORAGE_KEY, key);
    }
  };

  const fetchApps = useSubAppStore((state) => state.fetchApps);
  const appInfos = useSubAppStore((state) => state.appInfos);
  const user = useAuthStore((state) => state.user);
  const isLocalMode = useAuthStore((state) => state.isLocalMode);
  const loggedIn = useAuthStore((state) => state.loggedIn);
  const isAdmin = useIsAdmin();
  const pinnedApps = useSettingsStore((state) => state.pinnedApps);

  useEffect(() => {
    loadApps();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadApps = async () => {
    setLoading(true);
    try {
      await fetchApps();
      if (!isLocalMode) {
        try {
          setOwnedServerApps(await applicationManager.fetchUserApplications());
        } catch (err) {
          console.warn('Failed to load owned server apps:', err);
          setOwnedServerApps([]);
        }
        try {
          const publishedApps = await applicationManager.fetchApplications(true);
          setAllApps(publishedApps);
          // 治愈：以服务端为准回写本地 manifest 的 published 标记，修复旧版发布
          // 流程未回写而残留的脏数据（published:false / 缺字段）。
          const publishedNames = new Set(publishedApps.map(a => a.name));
          const healed = await applicationManager.reconcilePublishedFlags(
            useSubAppStore.getState().appInfos,
            publishedNames
          );
          if (healed > 0) {
            await fetchApps(); // 刷新，使治愈后的标记在 UI 反映
          }
        } catch (err) {
          console.warn('Failed to load published apps:', err);
        }
      } else {
        setOwnedServerApps([]);
        setAllApps([]);
      }
    } catch (error) {
      console.error('Failed to load apps:', error);
    } finally {
      setLoading(false);
    }
  };

  /**
   * Build the 我的 list:
   *  1) Local resources. When signed in to a server account, others'
   *     marketplace installs are hidden (they live on 收藏栏); local drafts
   *     whose author can't be attributed to anyone else stay visible so
   *     resources created offline / in local mode are never lost. Builtins
   *     are shown to admins only (so they can edit + overwrite-publish).
   *  2) Server apps the user owns that are missing locally (remote_only).
   */
  useEffect(() => {
    const publishedAppNames = new Set(allApps.map(a => a.name));
    const ownedIds = new Set(ownedServerApps.map(a => a.applicationId));
    const ownedNames = new Set(ownedServerApps.map(a => a.name));
    const accountMode = loggedIn && !isLocalMode && !!user;
    const items: MineItem[] = [];
    const matchedServerIds = new Set<string>();

    for (const info of appInfos) {
      if (info.source !== 'user') continue;
      const manifest = info.manifest;
      const isBuiltin = isBuiltinAppId(manifest.id);
      if (isBuiltin && !isAdmin) continue;

      const authoredByMe = isAuthoredByCurrentUser(manifest.author, user);
      if (!isBuiltin && accountMode && !authoredByMe) {
        // Someone else's marketplace app installed here → belongs on 收藏栏.
        const isOthersMarketApp =
          allApps.some(a => a.applicationId === manifest.id || a.name === manifest.name) &&
          !ownedIds.has(manifest.id) &&
          !ownedNames.has(manifest.name);
        if (isOthersMarketApp) continue;
      }

      const serverMatch =
        ownedServerApps.find(a => a.applicationId === manifest.id) ||
        ownedServerApps.find(a => a.name === manifest.name);
      if (serverMatch) matchedServerIds.add(serverMatch.applicationId);

      let appType: AppType = 'local';
      if (resolveAppPublished(manifest, publishedAppNames) || !!serverMatch?.published) {
        appType = 'published';
      } else if (authoredByMe) {
        appType = 'draft';
      }

      const remoteVersion = serverMatch?.version;
      const status: AppCardStatus = isBuiltin
        ? resolveLocalAppStatus({ origin: 'builtin', localVersion: manifest.version })
        : resolveLocalAppStatus({
            origin: 'own',
            isPublished: appType === 'published',
            localVersion: manifest.version,
            remoteVersion
          });

      items.push({
        key: info.id,
        localId: info.id,
        applicationId: serverMatch?.applicationId,
        name: manifest.name,
        version: manifest.version || remoteVersion || '1.0.0',
        remoteVersion,
        description: manifest.description || '',
        category: toTabKey(manifest.type),
        manifest,
        appType,
        status,
        hasLocal: true,
        isBuiltin
      });
    }

    // Owned server apps that are not on this machine (e.g. after switching client)
    for (const app of ownedServerApps) {
      if (matchedServerIds.has(app.applicationId)) continue;
      items.push({
        key: `remote:${app.applicationId}`,
        applicationId: app.applicationId,
        name: app.name,
        version: app.version || '1.0.0',
        remoteVersion: app.version,
        description: app.description || '',
        category: toTabKey(app.type),
        appType: app.published ? 'published' : 'local',
        status: 'remote_only',
        hasLocal: false,
        isBuiltin: false
      });
    }

    // Drafts first, cloud-only last; alphabetical within each group.
    const rank = (item: MineItem) =>
      item.status === 'draft' ? 0 : item.status === 'remote_only' ? 2 : 1;
    items.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
    setMineItems(items);
  }, [appInfos, user, allApps, ownedServerApps, isAdmin, isLocalMode, loggedIn]);

  /** 按资源类型分类，供各 Tab 取用。 */
  const itemsByCategory = useMemo(() => {
    const map: Record<MineTabKey, MineItem[]> = {
      app: [],
      'ai-skill': [],
      prompt: [],
      link: []
    };
    for (const item of mineItems) {
      map[item.category].push(item);
    }
    return map;
  }, [mineItems]);

  /** AI-skill self/managed entries handed to SkillsManager (local skills only). */
  const selfSkills = useMemo<SelfSkill[]>(
    () =>
      mineItems
        .filter((item) => item.category === 'ai-skill' && item.hasLocal && item.manifest)
        .map((item) => ({ id: item.localId!, manifest: item.manifest!, appType: item.appType })),
    [mineItems]
  );

  const tagStyle: React.CSSProperties = {
    margin: 0,
    fontSize: 10,
    lineHeight: '16px',
    height: 18,
    padding: '0 5px'
  };

  const getStatusTag = (item: MineItem) => {
    if (item.isBuiltin) {
      return <Tag color="blue" style={tagStyle}>{t('appStatus.builtin')}</Tag>;
    }
    switch (item.status) {
      case 'remote_only':
        return <Tag color="default" style={tagStyle}>{t('appStatus.remoteOnly')}</Tag>;
      case 'pending_publish':
        return <Tag color="gold" style={tagStyle}>{t('appStatus.pendingPublish')}</Tag>;
      case 'pending_update':
        return <Tag color="processing" style={tagStyle}>{t('appStatus.pendingUpdate')}</Tag>;
      default:
        break;
    }
    switch (item.appType) {
      case 'draft':
        return <Tag color="orange" style={tagStyle}>{t('mine.draft')}</Tag>;
      case 'published':
        return <Tag color="green" style={tagStyle}>{t('mine.published')}</Tag>;
      case 'local':
        return <Tag color="default" style={tagStyle}>{t('mine.local')}</Tag>;
    }
  };

  // Manifest type tag — mirrors 收藏栏 so cards have a consistent visual cue
  // for 应用/技能/提示词/链接 across pages (useful when browsing across tabs).
  const getManifestTypeTag = (type?: string) => {
    switch (type) {
      case 'ai-skill':
        return <Tag color="purple" style={tagStyle}>{t('workbench.tagSkill')}</Tag>;
      case 'prompt':
        return <Tag color="cyan" style={tagStyle}>{t('workbench.tagPrompt')}</Tag>;
      case 'link':
        return <Tag color="geekblue" style={tagStyle}>{t('workbench.tagLink')}</Tag>;
      case 'app':
      default:
        return null;  // 'app' is the default; tag would be noise
    }
  };

  const handleEdit = (appId: string, type?: string) => {
    // Pass `from` so editors' Back button + post-save navigation returns
    // here rather than the default 我的 page (matters when editor is opened
    // from another page like 发现 and the user came back here in between).
    if (type === 'ai-skill') {
      navigate('/developer/new-skill', { state: { appId, from: location.pathname } });
    } else if (type === 'prompt') {
      navigate('/developer/new-prompt', { state: { appId, from: location.pathname } });
    } else if (type === 'link') {
      navigate('/developer/new-link', { state: { appId, from: location.pathname } });
    } else {
      navigate(`/developer/code/${appId}`, { state: { from: location.pathname } });
    }
  };

  const handlePublish = (appId: string) => {
    navigate('/developer/publish', { state: { appId, from: location.pathname } });
  };

  const handleViewDetail = useCallback((appId: string) => {
    navigate(`/workbench/skill-detail/${appId}`);
  }, [navigate]);

  const handleRun = async (appId: string, appName: string) => {
    try {
      const result = seedTaskFromExecuteResult(
        await window.api.subapp.execute(appId, {}),
        appId,
        appName
      );
      if (result.earlyTerminal) {
        message.error(describeEarlyTerminal(result.earlyTerminal, t));
        return;
      }
      message.success(t('mine.appStarted', appName));
    } catch (error) {
      console.error('Failed to run app:', error);
      message.error(t('mine.runFailed'));
    }
  };

  const handleOpenLink = (manifest: SubAppManifest) => {
    const url = manifest.url;
    if (!url) {
      message.error(t('linkEditor.urlRequired'));
      return;
    }
    openExternalLink(url);
  };

  const handleInstallRemote = async (item: MineItem) => {
    if (!item.applicationId) return;
    const applicationId = item.applicationId;
    setInstalling((prev) => new Set(prev).add(applicationId));
    try {
      await applicationManager.installApplication(applicationId);
      message.success(t('mine.installSuccess', item.name));
      await loadApps();
    } catch (error) {
      console.error('Failed to install owned app:', error);
      message.error(t('mine.installFailed'));
    } finally {
      setInstalling((prev) => {
        const next = new Set(prev);
        next.delete(applicationId);
        return next;
      });
    }
  };

  /** Server record for a card: the matched owned app, else a published app by name. */
  const findServerApp = (item: MineItem): Application | undefined =>
    (item.applicationId
      ? ownedServerApps.find((a) => a.applicationId === item.applicationId) ||
        allApps.find((a) => a.applicationId === item.applicationId)
      : undefined) || allApps.find((a) => a.name === item.name);

  const handleUnpublish = (item: MineItem) => {
    const target = findServerApp(item);
    if (!target) {
      message.error(t('mine.unpublishNotFound'));
      return;
    }

    // modal.confirm 的 content 只渲染一次，用闭包变量记录勾选状态即可，
    // 无需 useState（避免为一次性弹窗引入额外重渲染）。
    let deleteLocalFiles = false;

    modal.confirm({
      title: t('mine.unpublishConfirmTitle'),
      content: (
        <div>
          <div>{t('mine.unpublishConfirmContent', item.name)}</div>
          {item.hasLocal && (
            <Checkbox
              style={{ marginTop: 12 }}
              onChange={(e) => {
                deleteLocalFiles = e.target.checked;
              }}
            >
              {t('mine.deleteLocalFilesOption')}
            </Checkbox>
          )}
        </div>
      ),
      okText: t('mine.unpublish'),
      okType: 'danger',
      cancelText: t('common.cancel'),
      onOk: async () => {
        try {
          await applicationManager.unpublishApplication(target.applicationId);

          // 回写本地 manifest 的 published:false，避免 resolveAppPublished 依赖
          // 本地残留的 published:true 脏标记继续误判为已发布（发布流程发布成功后
          // 也会做对称的 published:true 回写，参见 AppPublisher.tsx）。
          if (item.localId && item.manifest) {
            try {
              await window.api.developer.updateApp(item.localId, { ...item.manifest, published: false });
            } catch (writebackErr) {
              console.warn('Failed to write back unpublished flag:', writebackErr);
            }
          }

          if (deleteLocalFiles && item.localId) {
            try {
              const result = await window.api.subapp.uninstall(item.localId);
              if (!result.success) {
                // 本地文件本就可能不存在（如仅在服务端发布过、本地已手动清理），
                // 这里只提示，不影响下架本身已经成功。
                console.warn('Failed to delete local files:', result.error);
                message.warning(t('mine.localFilesDeleteFailed'));
              }
            } catch (deleteErr) {
              console.warn('Failed to delete local files:', deleteErr);
              message.warning(t('mine.localFilesDeleteFailed'));
            }
          }

          message.success(t('mine.unpublishSuccess'));
          await loadApps();
          // 只有真正成功了才退出抖动态；取消或失败都保持抖动，方便用户重试/改选。
          setIsJiggleMode(false);
        } catch (error) {
          console.error('Failed to unpublish app:', error);
          message.error(t('mine.unpublishFailed'));
        }
      }
    });
  };

  /** 草稿 / 本地（从未发布过）资源没有"下架"概念，直接删除本地文件即可。 */
  const handleDeleteLocal = (item: MineItem) => {
    if (!item.localId) return;
    const localId = item.localId;

    modal.confirm({
      title: t('mine.deleteConfirmTitle'),
      content: t('mine.deleteConfirmContent', item.name),
      okText: t('mine.delete'),
      okType: 'danger',
      cancelText: t('common.cancel'),
      onOk: async () => {
        try {
          const result = await window.api.subapp.uninstall(localId);
          if (!result.success) {
            console.warn('Failed to delete local files:', result.error);
            message.error(t('mine.deleteLocalFailed'));
            return; // 失败保持抖动态，不刷新列表
          }
          message.success(t('mine.deleteLocalSuccess'));
          await loadApps();
          setIsJiggleMode(false);
        } catch (error) {
          console.error('Failed to delete local app:', error);
          message.error(t('mine.deleteLocalFailed'));
        }
      }
    });
  };

  /** 仅云端且未发布的应用：删除服务端记录。 */
  const handleDeleteRemoteOnly = (item: MineItem) => {
    if (!item.applicationId) return;
    const applicationId = item.applicationId;
    modal.confirm({
      title: t('mine.deleteRemoteConfirmTitle'),
      content: t('mine.deleteRemoteConfirmContent', item.name),
      okText: t('mine.delete'),
      okType: 'danger',
      cancelText: t('common.cancel'),
      onOk: async () => {
        try {
          await applicationManager.deleteApplication(applicationId);
          message.success(t('mine.deleteRemoteSuccess'));
          await loadApps();
          setIsJiggleMode(false);
        } catch (error) {
          console.error('Failed to delete remote app:', error);
          message.error(t('mine.deleteRemoteFailed'));
        }
      }
    });
  };

  const handleCloseAction = (item: MineItem) => {
    if (item.appType === 'published') {
      handleUnpublish(item);
    } else if (item.hasLocal) {
      handleDeleteLocal(item);
    } else {
      handleDeleteRemoteOnly(item);
    }
  };

  const renderRoundAction = (
    key: string,
    title: string,
    icon: React.ReactNode,
    onClick: () => void,
    variant: 'primary' | 'neutral' = 'neutral',
    disabled = false
  ) => (
    <Tooltip key={key} title={title}>
      <button
        type="button"
        className={`cb-round-action-btn cb-round-action-${variant}${disabled ? ' is-loading' : ''}`}
        disabled={disabled}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
      >
        {icon}
      </button>
    </Tooltip>
  );

  const renderMineCard = (item: MineItem) => {
    const app = item.manifest;
    const isApp = item.category === 'app';
    const isLink = item.category === 'link';
    const isPublished = item.appType === 'published';
    const closeAction = isPublished ? t('mine.unpublish') : t('mine.delete');
    const isInstalling = !!(item.applicationId && installing.has(item.applicationId));
    const isPinned = !!item.localId && pinnedApps.includes(item.localId);
    const variant = item.isBuiltin ? 'builtin' : item.appType === 'draft' ? 'draft' : 'own-published';

    const actions: React.ReactNode[] = [];
    if (item.hasLocal && item.localId) {
      const localId = item.localId;
      actions.push(
        renderRoundAction('edit', t('mine.edit'), <EditOutlined style={{ fontSize: 14 }} />, () =>
          handleEdit(localId, app?.type)
        ),
        renderRoundAction(
          'publish',
          isPublished || item.status === 'pending_publish' ? t('mine.republish') : t('mine.publish'),
          <CloudUploadOutlined style={{ fontSize: 14, color: token.colorPrimary }} />,
          () => handlePublish(localId)
        )
      );
      if (isLink && app) {
        actions.push(
          renderRoundAction('open', t('workbench.open'), <ExportOutlined style={{ fontSize: 14 }} />, () =>
            handleOpenLink(app), 'primary')
        );
      } else if (isApp) {
        actions.push(
          renderRoundAction(
            'run',
            t('mine.run'),
            <CaretRightOutlined style={{ fontSize: 14, marginLeft: 2 }} />,
            () => handleRun(localId, item.name),
            'primary'
          )
        );
      }
    } else {
      actions.push(
        renderRoundAction(
          'install',
          isInstalling ? t('mine.installing') : t('mine.installLocal'),
          <DownloadOutlined style={{ fontSize: 14 }} />,
          () => handleInstallRemote(item),
          'primary',
          isInstalling
        )
      );
    }

    return (
      <FolderCard
        key={item.key}
        variant={variant}
        pinned={isPinned}
        className={isJiggleMode ? 'cb-glass-card--jiggling' : undefined}
        onPointerDown={startLongPress}
        onPointerUp={cancelLongPress}
        onPointerLeave={cancelLongPress}
        onPointerCancel={cancelLongPress}
      >
        {isJiggleMode && !item.isBuiltin && (
          // 作为卡片内容的子元素，随卡片的 jiggle 变换一起转动，视觉上"长在"
          // 卡片左上角，而不是独立抖动的贴纸。
          <Tooltip title={closeAction}>
            <div
              className="cb-card-close-btn"
              onClick={(e) => {
                e.stopPropagation();
                handleCloseAction(item);
              }}
              style={{
                background: token.colorError,
                border: `2px solid ${token.colorBgContainer}`
              }}
            >
              <CloseOutlined style={{ fontSize: 13, color: token.colorTextLightSolid }} />
            </div>
          </Tooltip>
        )}

        {/* Top row: icon + title */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            height: 32,
            width: 'calc(100% - 74px)'
          }}
        >
          <AppIcon icon={app?.icon} name={item.name} category={app?.category} size={28} />
          <Tooltip title={item.name}>
            <Text
              strong
              ellipsis
              style={{
                fontSize: 13,
                lineHeight: '20px',
                color: item.appType === 'draft' ? token.colorTextSecondary : undefined
              }}
            >
              {item.name}
            </Text>
          </Tooltip>
        </div>

        {/* Single-line description */}
        <div
          className="cb-card-desc"
          style={{
            fontSize: 12,
            lineHeight: '18px',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            margin: '6px 0'
          }}
        >
          {item.description || t('workbench.noDesc')}
        </div>

        {/* Tag row */}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', minHeight: 20, marginBottom: 8 }}>
          {getManifestTypeTag(item.category)}
          {getStatusTag(item)}
        </div>

        {/* Bottom row: version on the left, round actions on the right */}
        <div
          style={{
            marginTop: 'auto',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingTop: 8
          }}
        >
          <AppVersionTag
            localVersion={item.hasLocal ? item.version : undefined}
            remoteVersion={item.remoteVersion || (!item.hasLocal ? item.version : undefined)}
            status={item.status}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>{actions}</div>
        </div>
      </FolderCard>
    );
  };

  const gridStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))',
    gap: 12
  };

  const renderCardGrid = (items: MineItem[], emptyLabel: string) =>
    loading && items.length === 0 ? (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          minHeight: 240
        }}
      >
        <Spin size="large" />
        <Text style={{ marginTop: 16, color: token.colorTextSecondary }}>{t('mine.loading')}</Text>
      </div>
    ) : items.length === 0 ? (
      <Empty description={emptyLabel} />
    ) : (
      <Spin spinning={loading}>
        <div style={gridStyle}>{items.map((item) => renderMineCard(item))}</div>
      </Spin>
    );

  /** Cloud-only skills can't go through SkillsManager (no local files) — list them below it. */
  const remoteOnlySkills = itemsByCategory['ai-skill'].filter((item) => !item.hasLocal);

  const tabItems = [
    {
      key: 'app',
      label: t('mine.groupApp'),
      children: renderCardGrid(itemsByCategory.app, t('mine.emptyCategory'))
    },
    {
      key: 'ai-skill',
      label: t('mine.groupSkill'),
      children: (
        <>
          <SkillsManager
            selfSkills={selfSkills}
            onEditSelf={(id) => handleEdit(id, 'ai-skill')}
            onPublishSelf={(id) => handlePublish(id)}
            onDetailSelf={handleViewDetail}
          />
          {remoteOnlySkills.length > 0 && (
            <div style={{ marginTop: 16 }}>{renderCardGrid(remoteOnlySkills, t('mine.emptyCategory'))}</div>
          )}
        </>
      )
    },
    {
      key: 'prompt',
      label: t('mine.groupPrompt'),
      children: renderCardGrid(itemsByCategory.prompt, t('mine.emptyCategory'))
    },
    {
      key: 'link',
      label: t('mine.groupLink'),
      children: renderCardGrid(itemsByCategory.link, t('mine.emptyCategory'))
    }
  ];

  return (
    <div style={{ padding: 24 }}>
      <div style={{ marginBottom: 24, display: 'flex', alignItems: 'center', gap: 12 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(backTarget)}>
          {t('common.back')}
        </Button>
        <Title level={4} style={{ margin: 0 }}>{t('mine.title')}</Title>
      </div>

      <Tabs activeKey={activeTab} onChange={handleTabChange} items={tabItems} />
    </div>
  );
};

export default MyContributionsPage;
