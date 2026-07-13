/**
 * Shared schedule-rule helpers used by both the AI-Chat scheduled-task engine
 * and the app-scheduling engine. Kept here so the two schedulers cannot drift
 * apart in how they interpret repeat rules.
 */

export type RepeatRule = 'none' | 'daily' | 'weekly' | 'monthly'

/**
 * Minimal structural contract for anything that can be scheduled.
 * Both `ScheduledTask` and `AppSchedule` satisfy this shape.
 */
export interface ScheduleRule {
  repeatRule: RepeatRule
  time: string // "HH:MM"
  dayOfWeek?: number
  dayOfMonth?: number
  endDate?: string
}

/**
 * Compute the next run timestamp (ms epoch) for a schedule based on its rule.
 * Returns null for an unparseable time.
 */
export function computeNextRun(rule: ScheduleRule, fromTime?: number): number | null {
  const now = fromTime ?? Date.now()
  const parts = rule.time.split(':').map(Number)
  const hours = parts[0]
  const minutes = parts[1]
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null

  if (rule.repeatRule === 'none') {
    // One-shot: find next occurrence of the specified time today or tomorrow
    const today = new Date(now)
    today.setHours(hours, minutes, 0, 0)
    if (today.getTime() > now) return today.getTime()
    today.setDate(today.getDate() + 1)
    return today.getTime()
  }

  if (rule.repeatRule === 'daily') {
    const next = new Date(now)
    next.setHours(hours, minutes, 0, 0)
    if (next.getTime() <= now) {
      next.setDate(next.getDate() + 1)
    }
    return next.getTime()
  }

  if (rule.repeatRule === 'weekly') {
    const targetDay = rule.dayOfWeek ?? 0
    const next = new Date(now)
    next.setHours(hours, minutes, 0, 0)
    const currentDay = next.getDay()
    let daysUntil = targetDay - currentDay
    if (daysUntil < 0 || (daysUntil === 0 && next.getTime() <= now)) {
      daysUntil += 7
    }
    next.setDate(next.getDate() + daysUntil)
    return next.getTime()
  }

  if (rule.repeatRule === 'monthly') {
    const targetDate = rule.dayOfMonth ?? 1
    const next = new Date(now)
    next.setHours(hours, minutes, 0, 0)
    next.setDate(targetDate)
    if (next.getTime() <= now) {
      next.setMonth(next.getMonth() + 1)
      next.setDate(targetDate)
    }
    return next.getTime()
  }

  return null
}
