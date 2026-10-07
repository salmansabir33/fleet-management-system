import { useContext, useMemo } from 'react'
import { ManagerScopeContext } from '../context/ManagerScopeContext'
import { managerPath } from '../utils/managerApi'
import { useBasePath } from '../../shared/hooks/useBasePath'

// Shared by admin pages that also render under /manager/:managerId.
// Outside ManagerScopeProvider the context default has managerId=null,
// so callers treat that as "admin / unrestricted" mode.
export const usePanelScope = () => {
  const scope = useContext(ManagerScopeContext)
  const managerId = scope?.managerId ?? null
  const isManager = Boolean(managerId)
  const permissions = scope?.permissions || {}
  const shellBasePath = useBasePath()

  return useMemo(() => {
    const basePath = isManager ? `/manager/${managerId}` : shellBasePath

    const can = (permissionKey) => {
      if (!isManager) return true
      return Boolean(permissions?.[permissionKey])
    }

    const apiFor = (resource, adminFallback) => {
      if (!isManager) return adminFallback
      return managerPath(managerId, resource)
    }

    return {
      isManager,
      managerId,
      managerName: scope?.managerName ?? null,
      permissions,
      loading: Boolean(scope?.loading),
      basePath,
      can,
      apiFor,
    }
  }, [isManager, managerId, permissions, scope?.managerName, scope?.loading, shellBasePath])
}
