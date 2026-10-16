/**
 * نرمال‌سازی شماره تلفن ایران — ارقام فارسی/عربی و انگلیسی، قالب‌های ۰۹ / ۹۸ / +۹۸ / ۰۰۹۸
 * خروجی: 09xxxxxxxxx یا null
 */

const FA = '۰۱۲۳۴۵۶۷۸۹'
const AR = '٠١٢٣٤٥٦٧٨٩'

export function normalizeDigits(input: string): string {
  let out = ''
  for (const ch of input) {
    const fi = FA.indexOf(ch)
    if (fi !== -1) {
      out += String(fi)
      continue
    }
    const ai = AR.indexOf(ch)
    if (ai !== -1) {
      out += String(ai)
      continue
    }
    out += ch
  }
  return out
}

export function normalizePhone(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null
  let s = normalizeDigits(String(raw)).replace(/[\s\-().]/g, '')
  if (!s) return null
  if (s.startsWith('+98')) s = '0' + s.slice(3)
  else if (s.startsWith('0098')) s = '0' + s.slice(4)
  else if (s.startsWith('98') && s.length >= 11 && s.length <= 12) s = '0' + s.slice(2)
  else if (s.startsWith('9') && s.length === 10) s = '0' + s
  if (!/^09\d{9}$/.test(s)) return null
  return s
}

/** ماسک شماره برای گزارش‌ها: 0912***6789 */
export function maskPhone(phone: string): string {
  const p = normalizePhone(phone)
  if (!p) return '***'
  return `${p.slice(0, 4)}***${p.slice(7)}`
}
