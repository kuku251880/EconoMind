// Fallback for public statistics pages that require a JavaScript-capable browser.
import readline from 'node:readline'
import { chromium } from 'playwright-core'

const pages = /^https:\/\/www\.stats\.gov\.cn\/sj\/zxfb\/(?:index(?:_\d+)?\.html|\d{6}\/t\d{8}_\d+\.html)$/
const browser = await chromium.launch({ channel: 'msedge', headless: true })
try {
  const context = await browser.newContext({ acceptDownloads: false })
  for await (const line of readline.createInterface({ input: process.stdin })) {
    try {
      const urls = JSON.parse(line)
      if (!Array.isArray(urls) || !urls.length || urls.length > 4 || urls.some(url => typeof url !== 'string' || !pages.test(url))) {
        throw new Error('Invalid official publication URLs')
      }
      const html = await Promise.all(urls.map(async url => {
        const page = await context.newPage()
        try {
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 })
          await page.waitForFunction(() => document.title.includes('国家统计局'), { timeout: 12000 })
          if (page.url() !== url) throw new Error('Unexpected publication URL')
          const content = await page.content()
          if (Buffer.byteLength(content) > 3000000) throw new Error('Publication exceeded size limit')
          return content
        } finally {
          await page.close()
        }
      }))
      process.stdout.write(JSON.stringify({ html }) + '\n')
    } catch (error) {
      process.stdout.write(JSON.stringify({ error: String(error) }) + '\n')
    }
  }
} finally {
  await browser.close()
}
