import type { CustomFont } from '@shared/types'

// 常见可用字体族：系统通用 + Windows/Mac 常见中文字体（用户系统装了即可用）+ 用户导入字体
export const BUILTIN_FONTS: { family: string; label: string }[] = [
  { family: 'sans-serif', label: '无衬线（默认）' },
  { family: 'serif', label: '衬线' },
  { family: 'Microsoft YaHei', label: '微软雅黑' },
  { family: 'SimHei', label: '黑体' },
  { family: 'SimSun', label: '宋体' },
  { family: 'KaiTi', label: '楷体' },
  { family: 'PingFang SC', label: '苹方（Mac）' },
  { family: 'Source Han Sans SC', label: '思源黑体' },
  { family: 'Source Han Serif SC', label: '思源宋体' },
  { family: 'Arial', label: 'Arial' },
  { family: 'Georgia', label: 'Georgia' },
  { family: 'Impact', label: 'Impact' }
]

export function allFonts(custom: CustomFont[]): { family: string; label: string }[] {
  return [
    ...BUILTIN_FONTS,
    ...custom.map((c) => ({ family: c.family, label: `${c.family}（已导入）` }))
  ]
}
