// ساخت فایل اکسل تستی برای ایمپورت
import * as XLSX from 'xlsx'

const rows = [
  { 'نام و نام خانوادگی': 'الهام توکلی', 'نام کاربری': 'beheshti.t3', 'نقش': 'TEACHER', 'رمز عبور': '' },
  { 'نام و نام خانوادگی': 'حامد شریفی', 'نام کاربری': 'beheshti.s7', 'نقش': 'STUDENT', 'رمز عبور': '' },
  { 'نام و نام خانوادگی': 'نازنین اکبری', 'نام کاربری': 'beheshti.s8', 'نقش': 'دانش آموز', 'رمز عبور': '' },
  // ردیف خطادار: نام کاربری تکراری (موجود در مدرسه)
  { 'نام و نام خانوادگی': 'تکراری', 'نام کاربری': 'beheshti.t1', 'نقش': 'TEACHER', 'رمز عبور': '' },
  // ردیف خطادار: نقش نامعتبر
  { 'نام و نام خانوادگی': 'بی نقش', 'نام کاربری': 'binoq.user', 'نقش': 'MANAGER', 'رمز عبور': '' },
]

const ws = XLSX.utils.json_to_sheet(rows)
ws['!cols'] = [{ wch: 25 }, { wch: 20 }, { wch: 14 }, { wch: 15 }]
const wb = XLSX.utils.book_new()
XLSX.utils.book_append_sheet(wb, ws, 'کاربران')
XLSX.writeFile(wb, '/tmp/test-import.xlsx')
console.log('✓ /tmp/test-import.xlsx ساخته شد با', rows.length, 'ردیف')
