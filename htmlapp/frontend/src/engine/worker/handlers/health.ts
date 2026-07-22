import pkg from '../../../../package.json'

export type HealthStatus = {
  status: string
  service: string
  version: string
}

export async function healthGet(): Promise<HealthStatus> {
  return { status: 'ok', service: 'aica-htmlapp', version: pkg.version }
}
