// 生成图保存文件名：1.png … 100.png 循环（满 100 重置）。
// 用模块级计数器可靠递增，不受 localStorage 是否可用影响；localStorage 仅做跨会话续号。
let imgSeq = 0
export function nextImgName(ext = 'png'): string {
  if (imgSeq === 0) {
    try { imgSeq = parseInt(localStorage.getItem('cogpt_img_seq') || '0', 10) || 0 } catch { /* ignore */ }
  }
  imgSeq = (imgSeq % 100) + 1
  try { localStorage.setItem('cogpt_img_seq', String(imgSeq)) } catch { /* ignore */ }
  return `${imgSeq}.${ext}`
}
