import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../auth/AuthContext'
import { readActingAdminId } from '../../auth/actingAdminStorage'
import { ACTING_ADMIN_CHANGED_EVENT } from '../../auth/actingAdminEvents'
import {
  readSaAdminFilter,
  SA_ADMIN_FILTER_EVENT,
  saAdminFilterParams,
} from '../utils/saAdminFilter'

const EMPTY_PARAMS = Object.freeze({})

function useSaFilterTick() {
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const bump = () => setTick((n) => n + 1)
    window.addEventListener(SA_ADMIN_FILTER_EVENT, bump)
    window.addEventListener(ACTING_ADMIN_CHANGED_EVENT, bump)
    window.addEventListener('storage', bump)
    return () => {
      window.removeEventListener(SA_ADMIN_FILTER_EVENT, bump)
      window.removeEventListener(ACTING_ADMIN_CHANGED_EVENT, bump)
      window.removeEventListener('storage', bump)
    }
  }, [])

  return tick
}

/** Query params (?admin_id=) for super-admin global list views. */
export function useSaAdminListParams() {
  const { role } = useAuth()
  const tick = useSaFilterTick()

  return useMemo(() => {
    void tick
    const actingAdminId = readActingAdminId()
    const params = saAdminFilterParams(role, actingAdminId)
    return params.admin_id != null ? params : EMPTY_PARAMS
  }, [role, tick])
}

export function useShowSaAdminFilter() {
  const { role } = useAuth()
  const tick = useSaFilterTick()
  void tick
  const actingAdminId = readActingAdminId()
  return role === 'super_admin' && actingAdminId == null
}

export { readSaAdminFilter }
