import React from 'react'
import { DatePicker } from 'antd'
import dayjs from 'dayjs'
import type { ColDef } from '../../../types/copiper'

interface DateTimeEditorProps {
  value: unknown
  colDef: ColDef
  onChange: (value: unknown) => void
  onBlur?: () => void
  autoFocus?: boolean
}

const DateTimeEditor: React.FC<DateTimeEditorProps> = ({ value, onChange, onBlur, autoFocus }) => {
  const toMoment = (): dayjs.Dayjs | null => {
    if (value == null || value === '' || value === 0) return null
    const num = Number(value)
    if (!isNaN(num) && num > 0) {
      // UTC timestamp in seconds
      return dayjs.unix(num)
    }
    // Try parsing as date string
    const parsed = dayjs(String(value))
    return parsed.isValid() ? parsed : null
  }

  return (
    <DatePicker
      size="small"
      autoFocus={autoFocus}
      showTime
      defaultValue={toMoment()}
      style={{ width: '100%' }}
      onChange={(date) => {
        if (date) {
          onChange(date.unix())
        } else {
          onChange(0)
        }
        onBlur?.()
      }}
      onBlur={onBlur}
    />
  )
}

export default DateTimeEditor
