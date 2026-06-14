/**
 * 把用户填的中转站地址规整成「base」形式(/v1 之前的部分)。
 * 设计师常会把文档里看到的完整端点(如 .../v1/images/generations)整条粘进来,
 * 这里自动截断,避免出错。
 */
export function normalizeBaseUrl(raw: string): string {
  let u = (raw || '').trim()
  if (!u) return u
  u = u.replace(/\/+$/, '') // 去掉末尾斜杠
  // 若包含 /v1 或 /v1/任意路径,截断到 /v1 之前
  u = u.replace(/\/v1(?:\/.*)?$/i, '')
  return u.replace(/\/+$/, '')
}
