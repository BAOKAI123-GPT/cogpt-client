import type { ReactNode } from 'react'

// 模型图标：按模型名确定性生成「带专属抽象主体的科技图形」（参考青云中转站风格，与网页 /app 同一算法）——
// 深紫底 + 一个独立视觉主体(轨道/棱镜/晶体/声波/同心/六边形/星芒/立方/波纹/点阵/双环/层叠)，不同模型不同主体+点缀色，拒绝纯渐变。
function hashSeed(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function motif(m: number, W: string, Wd: string, AC: string): ReactNode {
  switch (m) {
    case 0: return (<g fill="none" stroke={W} strokeWidth="2.4"><ellipse cx="50" cy="50" rx="30" ry="12" transform="rotate(-28 50 50)" /><circle cx="50" cy="50" r="9" fill={AC} stroke="none" /><circle cx="74" cy="36" r="3.6" fill={W} stroke="none" /></g>)
    case 1: return (<g fill="none" stroke={W} strokeWidth="2.4" strokeLinejoin="round"><path d="M50 26 L72 66 L28 66 Z" /><path d="M50 26 L50 66" stroke={AC} strokeWidth="2" /></g>)
    case 2: return (<g fill="none" stroke={W} strokeWidth="2.4" strokeLinejoin="round"><path d="M50 24 L73 50 L50 76 L27 50 Z" /><path d="M27 50 H73 M50 24 V76" stroke={Wd} strokeWidth="1.4" /></g>)
    case 3: return (<g fill={W}><rect x="29" y="46" width="7" height="20" rx="2" /><rect x="42" y="34" width="7" height="32" rx="2" fill={AC} /><rect x="55" y="42" width="7" height="24" rx="2" /><rect x="68" y="52" width="7" height="14" rx="2" /></g>)
    case 4: return (<g fill="none" strokeWidth="2.4"><circle cx="50" cy="50" r="22" stroke={Wd} /><circle cx="50" cy="50" r="14" stroke={W} /><circle cx="50" cy="50" r="5" fill={AC} stroke="none" /></g>)
    case 5: return (<g fill="none" stroke={W} strokeWidth="2.4" strokeLinejoin="round"><path d="M50 26 L71 38 L71 62 L50 74 L29 62 L29 38 Z" /><circle cx="50" cy="50" r="6" fill={AC} stroke="none" /></g>)
    case 6: return (<path d="M50 23 C53 44 56 47 77 50 C56 53 53 56 50 77 C47 56 44 53 23 50 C44 47 47 44 50 23 Z" fill={W} />)
    case 7: return (<g fill="none" stroke={W} strokeWidth="2.2" strokeLinejoin="round"><path d="M50 27 L71 39 L71 61 L50 73 L29 61 L29 39 Z" /><path d="M50 27 L50 50 L71 39 M50 50 L29 39 M50 50 L50 73" stroke={Wd} /></g>)
    case 8: return (<path d="M24 56 Q37 30 50 50 T76 44" fill="none" stroke={AC} strokeWidth="3.2" strokeLinecap="round" />)
    case 9: return (<g>{[0, 1, 2].map((i) => [0, 1, 2].map((j) => (<circle key={`${i}-${j}`} cx={36 + j * 14} cy={36 + i * 14} r="3.5" fill={(i + j) % 2 ? AC : W} />)))}</g>)
    case 10: return (<g fill="none" strokeWidth="2.6"><circle cx="40" cy="50" r="15" stroke={W} /><circle cx="60" cy="50" r="15" stroke={AC} /></g>)
    default: return (<g fill="none" strokeLinejoin="round" strokeWidth="2.3"><rect x="30" y="31" width="40" height="12" rx="4" stroke={Wd} /><rect x="30" y="44" width="40" height="12" rx="4" stroke={W} /><rect x="30" y="57" width="40" height="12" rx="4" stroke={AC} /></g>)
  }
}

export default function ModelArt({ seed, className }: { seed: string; className?: string }): JSX.Element {
  const h = hashSeed(seed || 'x')
  const r = (n: number): number => ((h >>> (n * 4)) & 0xff) / 255
  const id = 'ma' + (h % 1000000)
  const base = 250 + Math.floor(r(1) * 32)
  const accent = r(2) > 0.5 ? 300 + Math.floor(r(3) * 22) : 186 + Math.floor(r(4) * 24)
  const AC = `hsl(${accent}, 90%, 66%)`
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" className={className} aria-hidden="true">
      <defs>
        <linearGradient id={id + 'bg'} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={`hsl(${base}, 44%, 15%)`} />
          <stop offset="1" stopColor={`hsl(${base - 14}, 40%, 25%)`} />
        </linearGradient>
        <radialGradient id={id + 'gl'} cx="30%" cy="26%" r="72%">
          <stop offset="0" stopColor={AC} stopOpacity="0.32" />
          <stop offset="1" stopColor={AC} stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="100" height="100" fill={`url(#${id}bg)`} />
      <rect width="100" height="100" fill={`url(#${id}gl)`} />
      {motif(h % 12, 'rgba(255,255,255,0.95)', 'rgba(255,255,255,0.5)', AC)}
    </svg>
  )
}
