import { describe, it, expect } from 'vitest'
import { pickArchiver } from '../scripts/zip-dist.mjs'

describe('pickArchiver', () => {
  it('always picks PowerShell on Windows, regardless of PATH contents', () => {
    const result = pickArchiver('win32', [], () => false)
    expect(result).toEqual({ archiver: 'powershell', reason: null })
  })

  it('picks zip when a zip executable is found on PATH', () => {
    const exists = (p: string) => p === '/usr/bin/zip'
    const result = pickArchiver('linux', ['/usr/local/bin', '/usr/bin'], exists)
    expect(result).toEqual({ archiver: 'zip', reason: null })
  })

  it('reports no archiver — rather than throwing — when zip is absent from every PATH dir', () => {
    const result = pickArchiver('linux', ['/usr/local/bin', '/usr/bin'], () => false)
    expect(result.archiver).toBeNull()
    expect(result.reason).toMatch(/zip/)
  })
})
