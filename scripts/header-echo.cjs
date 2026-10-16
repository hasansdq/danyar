// سرور اکوی هدر — برای اثبات اینکه Caddy چه هدرهایی به آپ‌استریم می‌فرستد
const http = require('http')

const srv = http.createServer((req, res) => {
  const body = JSON.stringify(
    {
      'x-forwarded-proto': req.headers['x-forwarded-proto'] ?? null,
      'x-forwarded-host': req.headers['x-forwarded-host'] ?? null,
      host: req.headers.host ?? null,
    },
    null,
    2,
  )
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(body)
})

srv.listen(9999, '127.0.0.1', () => console.log('echo on 9999'))
setTimeout(() => process.exit(0), 600000)
