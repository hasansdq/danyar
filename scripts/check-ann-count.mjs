/** بررسی شمارش اطلاعیه‌ها: خام در برابر حذف‌تکرارشده */
import Database from 'bun:sqlite'
const db = new Database('/home/z/my-project/db/custom.db', { readonly: true })

const rows = db
  .prepare(
    `SELECT m.senderId, m.body, m.createdAt
     FROM Message m
     JOIN SubjectGroup sg ON sg.id = m.subjectGroupId
     JOIN Classroom c ON c.id = sg.classroomId
     WHERE m.isAnnouncement = 1 AND m.deletedAt IS NULL`,
  )
  .all()

console.log('raw announcement rows:', rows.length)

// همان منطق سرور: فرستنده + متن + بازه ۱۰ ثانیه‌ای
rows.sort((a, b) => a.createdAt - b.createdAt)
let count = 0
let last = null
for (const m of rows) {
  if (
    last &&
    last.senderId === m.senderId &&
    last.body === m.body &&
    Math.abs(m.createdAt - last.at) <= 10_000
  )
    continue
  count++
  last = { senderId: m.senderId, body: m.body, at: m.createdAt }
}
console.log('deduped announcement events:', count)

// نمونه: چند رویداد آخر
const seen = []
last = null
for (const m of rows) {
  if (
    last &&
    last.senderId === m.senderId &&
    last.body === m.body &&
    Math.abs(m.createdAt - last.at) <= 10_000
  )
    continue
  seen.push(new Date(m.createdAt).toISOString().slice(0, 16) + ' | ' + m.body.slice(0, 40))
  last = { senderId: m.senderId, body: m.body, at: m.createdAt }
}
console.log('\nنمونه ۱۰ رویداد آخر:')
for (const s of seen.slice(-10)) console.log(' ', s)
