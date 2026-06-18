// 生成图保存文件名：1.png … 100.png 循环（满 100 重置）
export function nextImgName(ext = 'png'): string {
  let n = 1
  try {
    n = ((parseInt(localStorage.getItem('cogpt_img_seq') || '0', 10) || 0) % 100) + 1
    localStorage.setItem('cogpt_img_seq', String(n))
  } catch {
    /* ignore */
  }
  return `${n}.${ext}`
}
