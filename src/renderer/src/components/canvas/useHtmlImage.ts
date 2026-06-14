import { useEffect, useState } from 'react'

/** 把 dataURL 加载成 HTMLImageElement，供 react-konva 的 <Image> 使用 */
export function useHtmlImage(src?: string): HTMLImageElement | undefined {
  const [img, setImg] = useState<HTMLImageElement | undefined>()
  useEffect(() => {
    if (!src) {
      setImg(undefined)
      return
    }
    const i = new window.Image()
    i.onload = () => setImg(i)
    i.src = src
    return () => {
      i.onload = null
    }
  }, [src])
  return img
}
