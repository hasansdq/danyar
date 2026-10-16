import sharp from 'sharp'
import { readFileSync } from 'fs'
import path from 'path'

/** تولید آیکون‌های PWA از لوگوی دانیار */
async function main() {
  const svgPath = path.join(process.cwd(), 'public', 'daniar-logo.svg')
  const svg = readFileSync(svgPath)

  for (const size of [192, 512]) {
    const out = path.join(process.cwd(), 'public', 'icons', `icon-${size}.png`)
    await sharp(svg, { density: 300 })
      .resize(size, size)
      .png()
      .toFile(out)
    console.log(`✔ icon-${size}.png`)
  }

  // آیکون maskable با پس‌زمینه پر و حاشیه امن
  const inner = Math.round(512 * 0.72)
  const maskable = `<svg width="512" height="512" xmlns="http://www.w3.org/2000/svg">
    <rect width="512" height="512" rx="0" fill="#0d9488"/>
    <g transform="translate(${(512 - inner) / 2}, ${(512 - inner) / 2}) scale(${inner / 512})">
      ${readFileSync(svgPath, 'utf-8').replace(/<\?xml[^>]*\?>/, '')}
    </g>
  </svg>`
  await sharp(Buffer.from(maskable), { density: 300 })
    .resize(512, 512)
    .png()
    .toFile(path.join(process.cwd(), 'public', 'icons', 'icon-maskable-512.png'))
  console.log('✔ icon-maskable-512.png')

  // apple-touch-icon
  await sharp(svg, { density: 300 })
    .resize(180, 180)
    .png()
    .toFile(path.join(process.cwd(), 'public', 'icons', 'apple-touch-icon.png'))
  console.log('✔ apple-touch-icon.png')
}

main()
