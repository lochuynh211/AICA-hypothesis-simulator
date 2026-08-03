import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import DataErrorScreen from '../src/components/layout/DataErrorScreen'
import { DataRegistryError } from '../src/data/registry'

describe('DataErrorScreen', () => {
  it('lists every problem, not just the first', () => {
    const err = new DataRegistryError(['presets: is empty', 'scenarios: missing or not an object'])
    render(<DataErrorScreen error={err} />)
    expect(screen.getByText(/presets: is empty/)).toBeInTheDocument()
    expect(screen.getByText(/scenarios: missing or not an object/)).toBeInTheDocument()
  })

  it('tells the reader how to regenerate the data', () => {
    render(<DataErrorScreen error={new DataRegistryError(['presets: is empty'])} />)
    expect(screen.getByText(/npm run build:data/)).toBeInTheDocument()
  })
})
