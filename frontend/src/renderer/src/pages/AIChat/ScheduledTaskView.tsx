import React from 'react'
import { useScheduledTaskStore } from '../../stores/useScheduledTaskStore'
import ScheduledTaskList from './ScheduledTaskList'
import ScheduledTaskEditor from './ScheduledTaskEditor'

const ScheduledTaskView: React.FC = () => {
  const activeView = useScheduledTaskStore((s) => s.activeView)

  return activeView === 'editor' ? <ScheduledTaskEditor /> : <ScheduledTaskList />
}

export default ScheduledTaskView
