// config.test.js — validación de configuración por entorno (config.js).
import { describe, it, expect } from 'vitest'
import { loadConfig } from '../src/config.js'

describe('config', () => {
  it('en producción SESSION_SECRET es obligatorio (issue #168)', () => {
    expect(() => loadConfig({ NODE_ENV: 'production', SESSION_SECRET: undefined })).toThrow()
  })

  it('en producción con SESSION_SECRET válido la configuración pasa', () => {
    const cfg = loadConfig({
      NODE_ENV: 'production',
      SESSION_SECRET: 'a'.repeat(32),
    })
    expect(cfg.SESSION_SECRET).toBe('a'.repeat(32))
  })

  it('en desarrollo sin SESSION_SECRET la configuración pasa (fallback kv)', () => {
    const cfg = loadConfig({ NODE_ENV: 'development' })
    expect(cfg.SESSION_SECRET).toBeUndefined()
  })
})
