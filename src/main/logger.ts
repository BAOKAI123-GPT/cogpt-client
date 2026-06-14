// 简单的内存环形日志，用于排查生图/导出等报错。可在设置里查看与导出。
export interface LogEntry {
  t: number
  level: 'info' | 'error'
  msg: string
}

const buf: LogEntry[] = []
const MAX = 800

export function log(level: 'info' | 'error', msg: string): void {
  buf.push({ t: Date.now(), level, msg })
  if (buf.length > MAX) buf.shift()
}

export function getLogs(): LogEntry[] {
  return buf.slice()
}

export function clearLogs(): void {
  buf.length = 0
}

export function formatLogs(): string {
  return buf
    .map((e) => `[${new Date(e.t).toISOString()}] ${e.level.toUpperCase()} ${e.msg}`)
    .join('\n')
}
