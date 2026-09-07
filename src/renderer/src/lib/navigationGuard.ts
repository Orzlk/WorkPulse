export interface NavigationGuardRegistration {
  id: string
  priority: number
  request: () => boolean | Promise<boolean>
}

export interface NavigationGuard {
  register: (registration: NavigationGuardRegistration) => () => void
  unregister: (id: string) => void
  requestNavigation: (nextPage: string, navigate: () => void) => Promise<boolean>
}

export function createNavigationGuard(): NavigationGuard {
  const registrations = new Map<string, NavigationGuardRegistration>()

  return {
    register: (registration) => {
      registrations.set(registration.id, registration)
      return () => registrations.delete(registration.id)
    },
    unregister: (id) => { registrations.delete(id) },
    requestNavigation: async (_nextPage, navigate) => {
      let top: NavigationGuardRegistration | undefined
      registrations.forEach((candidate) => {
        if (!top || candidate.priority > top.priority) top = candidate
      })
      if (top && !(await top.request())) return false
      navigate()
      return true
    }
  }
}

const globalNavigationGuard = createNavigationGuard()

export const registerNavigationGuard = globalNavigationGuard.register
export const unregisterNavigationGuard = globalNavigationGuard.unregister
export const requestNavigation = globalNavigationGuard.requestNavigation
