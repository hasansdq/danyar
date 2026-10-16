import { NextRequest, NextResponse } from 'next/server'
import { createReadStream } from 'fs'
import { stat } from 'fs/promises'
import path from 'path'
import { Readable } from 'stream'
import { db } from '@/lib/db'
import { requireAppRole } from '@/lib/api-auth'
import { getAccessibleGroup } from '@/lib/chat-access'
import { countDownload } from '@/lib/serve-file'

export const runtime = 'nodejs'

type Params = { params: Promise<{ id: string }> }

function uploadDir(): string {
  return process.env.UPLOAD_DIR ?? path.join(process.cwd(), 'uploads')
}

/**
 * سرو فایل پیوست با کنترل دسترسی سمت سرور:
 * گروه → عضویت واقعی؛ خصوصی → فقط طرفین گفتگو
 */
export async function GET(req: NextRequest, { params }: Params) {
  const res = await requireAppRole()
  if ('response' in res) return res.response
  const session = res.session
  const { id } = await params

  const message = await db.message.findUnique({ where: { id } })
  if (!message || message.deletedAt || !message.attachmentKey) {
    return NextResponse.json({ error: 'فایل یافت نشد' }, { status: 404 })
  }

  // بررسی دسترسی به گفتگوی پیام
  if (message.kind === 'GROUP' && message.subjectGroupId) {
    const group = await getAccessibleGroup(session, message.subjectGroupId)
    if (!group) return NextResponse.json({ error: 'دسترسی غیرمجاز' }, { status: 403 })
  } else if (message.kind === 'DIRECT') {
    if (message.senderId !== session.uid && message.recipientId !== session.uid) {
      return NextResponse.json({ error: 'دسترسی غیرمجاز' }, { status: 403 })
    }
  } else {
    return NextResponse.json({ error: 'فایل یافت نشد' }, { status: 404 })
  }

  const safeKey = path.basename(message.attachmentKey)
  const filePath = path.join(uploadDir(), safeKey)
  let fileStat
  try {
    fileStat = await stat(filePath)
    if (!fileStat.isFile()) throw new Error('not a file')
  } catch {
    return NextResponse.json({ error: 'فایل یافت نشد' }, { status: 404 })
  }

  const mime = message.attachmentMime || 'application/octet-stream'
  const name = (message.attachmentName || 'file').replace(/["\r\n]/g, '')
  const encodedName = encodeURIComponent(name)

  const baseHeaders: Record<string, string> = {
    'content-type': mime,
    'content-disposition': `inline; filename*=UTF-8''${encodedName}`,
    'cache-control': 'private, max-age=31536000, immutable',
    'accept-ranges': 'bytes',
  }

  // پشتیبانی از Range برای پخش روان صوت/ویدئو
  const range = req.headers.get('range')
  if (range) {
    const m = range.match(/bytes=(\d*)-(\d*)/)
    if (m) {
      const start = m[1] ? parseInt(m[1], 10) : 0
      const end = m[2] ? Math.min(parseInt(m[2], 10), fileStat.size - 1) : fileStat.size - 1
      if (start >= fileStat.size || start > end) {
        return new NextResponse(null, {
          status: 416,
          headers: { 'content-range': `bytes */${fileStat.size}` },
        })
      }
      const stream = createReadStream(filePath, { start, end })
      return new NextResponse(Readable.toWeb(stream) as unknown as ReadableStream, {
        status: 206,
        headers: {
          ...baseHeaders,
          'content-range': `bytes ${start}-${end}/${fileStat.size}`,
          'content-length': String(end - start + 1),
        },
      })
    }
  }

  // دریافت کامل → شمارش (قطعات ۲۰۶ پخش روان شمرده نمی‌شوند)
  countDownload(safeKey)
  const stream = createReadStream(filePath)
  return new NextResponse(Readable.toWeb(stream) as unknown as ReadableStream, {
    status: 200,
    headers: { ...baseHeaders, 'content-length': String(fileStat.size) },
  })
}
