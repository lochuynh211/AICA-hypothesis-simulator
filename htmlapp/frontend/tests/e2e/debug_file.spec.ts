import { test } from '@playwright/test'
import { pathToFileURL } from 'node:url'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const dist = resolve(__dirname, '..', '..', 'dist')

test('debug file://', async ({ page }) => {
  const consoleMessages: string[] = []
  const pageErrors: string[] = []
  const failedRequests: string[] = []

  page.on('console', msg => consoleMessages.push(`${msg.type()}: ${msg.text()}`))
  page.on('pageerror', err => pageErrors.push(err.message))
  page.on('requestfailed', req => failedRequests.push(`FAILED: ${req.url().substring(0,80)} - ${req.failure()?.errorText}`))

  const fileUrl = pathToFileURL(resolve(dist, 'index.html')).href
  console.log('Navigating to:', fileUrl)
  await page.goto(fileUrl)
  await page.waitForTimeout(5000)

  console.log('CONSOLE:', JSON.stringify(consoleMessages.slice(0,10)))
  console.log('ERRORS:', JSON.stringify(pageErrors.slice(0,5)))
  console.log('FAILED:', JSON.stringify(failedRequests.slice(0,5)))
  console.log('BODY:', (await page.locator('body').innerHTML()).substring(0, 500))
})
