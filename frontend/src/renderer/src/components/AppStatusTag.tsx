/**
 * Shared status + version tags for workbench / discover / mine cards.
 */

import React from 'react'
import { Tag } from 'antd'
import {
  appStatusLabelKey,
  appStatusTagColor,
  discoverStatusLabelKey,
  shouldShowVersionDiff,
  type AppCardStatus,
  type DiscoverCardStatus
} from '../utils/app-status'
import { useT } from '../i18n'

export const AppStatusTag: React.FC<{ status: AppCardStatus }> = ({ status }) => {
  const t = useT()
  return (
    <Tag color={appStatusTagColor(status)} style={{ margin: 0 }}>
      {t(appStatusLabelKey(status))}
    </Tag>
  )
}

export const DiscoverStatusTag: React.FC<{ status: DiscoverCardStatus }> = ({ status }) => {
  const t = useT()
  if (status === 'not_installed') return null
  const color =
    status === 'pending_update'
      ? 'processing'
      : status === 'reset_online'
        ? 'warning'
        : 'default'
  return (
    <Tag color={color} style={{ margin: 0 }}>
      {t(discoverStatusLabelKey(status))}
    </Tag>
  )
}

/** Version chip: plain `v1.0.0` or `v1.0.0 → v1.1.0` when mismatched. */
export const AppVersionTag: React.FC<{
  localVersion?: string | null
  remoteVersion?: string | null
  status: AppCardStatus | DiscoverCardStatus
}> = ({ localVersion, remoteVersion, status }) => {
  const local = localVersion || remoteVersion
  if (!local && !remoteVersion) return null
  if (shouldShowVersionDiff(status) && localVersion && remoteVersion) {
    return (
      <Tag style={{ margin: 0 }} color="default">
        v{localVersion} → v{remoteVersion}
      </Tag>
    )
  }
  return <Tag style={{ margin: 0 }}>v{local || remoteVersion}</Tag>
}
