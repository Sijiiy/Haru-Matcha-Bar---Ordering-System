import { createStaffApi } from './staffApi.js'
import { createStaffDemoApi } from './staffDemo.js'

export function createStaffClient(env = {}, options) {
  return env.VITE_STAFF_DEMO === 'true' ? createStaffDemoApi() : createStaffApi(options)
}
