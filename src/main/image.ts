import sharp from 'sharp'
import { vectorize } from '@neplex/vectorizer'
import type {
  ImageInfo,
  ProcessImageRequest,
  ProcessImageResult
} from '../shared/types'

function parseDataUrl(dataUrl: string): { mime: string; buffer: Buffer } {
  const m = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl)
  if (!m) throw new Error('无效的图片数据')
  return { mime: m[1], buffer: Buffer.from(m[2], 'base64') }
}

function mimeFor(format: 'png' | 'jpeg' | 'webp'): string {
  return format === 'jpeg' ? 'image/jpeg' : `image/${format}`
}

export async function getImageInfo(dataUrl: string): Promise<ImageInfo> {
  const { buffer } = parseDataUrl(dataUrl)
  const meta = await sharp(buffer).metadata()
  return {
    width: meta.width ?? 0,
    height: meta.height ?? 0,
    format: meta.format ?? 'unknown',
    bytes: buffer.length
  }
}

/**
 * 统一的本地图像处理：缩放（降分辨率）、Lanczos 放大、格式转换、压缩。
 * 放大不依赖任何在线模型，使用 sharp 的 Lanczos3 重采样（本地免费放大）。
 */
export async function processImage(
  req: ProcessImageRequest
): Promise<ProcessImageResult> {
  try {
    const { buffer } = parseDataUrl(req.dataUrl)
    let pipeline = sharp(buffer, { failOn: 'none' })
    const meta = await pipeline.metadata()
    const srcW = meta.width ?? 0
    const srcH = meta.height ?? 0

    let targetW = req.width
    let targetH = req.height
    if (req.scale && req.scale > 0 && !targetW && !targetH) {
      targetW = Math.round(srcW * req.scale)
      targetH = Math.round(srcH * req.scale)
    }

    if (targetW || targetH) {
      const both = !!targetW && !!targetH
      // 显式 fit 优先；否则：两维都给=拉伸，单维=按比例
      const fit = req.fit ?? (both ? 'fill' : 'inside')
      pipeline = pipeline.resize({
        width: targetW,
        height: targetH,
        fit,
        position: 'centre',
        withoutEnlargement: false,
        kernel: 'lanczos3' // 高质量重采样，放大/缩小都用它
      })
    }

    const format = req.format ?? (meta.format === 'jpeg' ? 'jpeg' : 'png')
    const quality = req.quality ?? 90
    if (format === 'jpeg') pipeline = pipeline.jpeg({ quality, mozjpeg: true })
    else if (format === 'webp') pipeline = pipeline.webp({ quality })
    else pipeline = pipeline.png({ compressionLevel: 9 })

    const out = await pipeline.toBuffer({ resolveWithObject: true })
    return {
      ok: true,
      dataUrl: `data:${mimeFor(format)};base64,${out.data.toString('base64')}`,
      width: out.info.width,
      height: out.info.height,
      bytes: out.data.length
    }
  } catch (e: any) {
    return { ok: false, error: `图片处理失败：${e?.message ?? e}` }
  }
}

/** 栅格转矢量（VTracer）。返回 SVG 字符串——矢量可无限放大不糊，达到印刷级。 */
export async function vectorizeImage(dataUrl: string): Promise<string> {
  const { buffer } = parseDataUrl(dataUrl)
  const png = await sharp(buffer, { failOn: 'none' }).png().toBuffer()
  return await vectorize(png)
}

/** 把 SVG 渲染成指定宽度的高清 PNG（dataURL） */
export async function rasterizeSvg(svg: string, targetWidth: number): Promise<string> {
  const svgBuf = Buffer.from(svg)
  const meta = await sharp(svgBuf).metadata()
  const intrinsicW = meta.width || targetWidth
  const density = Math.min(2400, Math.max(72, Math.round((72 * targetWidth) / intrinsicW)))
  const out = await sharp(svgBuf, { density }).resize({ width: targetWidth }).png().toBuffer()
  return `data:image/png;base64,${out.toString('base64')}`
}

/** 把任意 dataURL 转成指定格式的 Buffer（用于保存到磁盘） */
export async function toBuffer(
  dataUrl: string,
  format: 'png' | 'jpeg' | 'webp',
  quality = 92
): Promise<Buffer> {
  const { buffer } = parseDataUrl(dataUrl)
  let p = sharp(buffer, { failOn: 'none' })
  if (format === 'jpeg') p = p.flatten({ background: '#ffffff' }).jpeg({ quality })
  else if (format === 'webp') p = p.webp({ quality })
  else p = p.png()
  return p.toBuffer()
}
