import { useEffect, useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import api from '../../api'
import { Modal, Button, Checkbox } from '../../shared/components'
import { useTheme } from '../../theme'

// Checkboxes are persisted (PATCH /api/managers/{id}/permissions) and
// enforced on manager-panel mutating routes + matching Manager UI
// action buttons. Admin `/api/managers*` CRUD stays unrestricted.
const PermissionsModal = ({ manager, onClose, onSaved }) => {
  const { tokens } = useTheme()
  const [catalog, setCatalog] = useState([])
  const [checked, setChecked] = useState({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const res = await api.get('/api/settings/permissions')
        if (!cancelled) {
          setCatalog((res.data || []).filter((row) => row.is_active !== false))
        }
      } catch (err) {
        console.error('Failed to load permission keys:', err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    setChecked(manager.permissions || {})
  }, [manager.id, manager.permissions])

  const toggle = (key) => {
    setChecked((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    const permissionsPayload = Object.fromEntries(catalog.map((row) => [row.key, !!checked[row.key]]))
    // #region agent log
    fetch('http://127.0.0.1:7348/ingest/99aea8f7-ccdc-46d2-87be-cf18a1a897d9',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'420bea'},body:JSON.stringify({sessionId:'420bea',runId:'pre-fix',hypothesisId:'B',location:'PermissionsModal.jsx:handleSave:entry',message:'save permissions clicked',data:{managerId:manager?.id,catalogLen:catalog.length,permKeys:Object.keys(permissionsPayload),trueCount:Object.values(permissionsPayload).filter(Boolean).length},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    try {
      const res = await api.patch(`/api/managers/${manager.id}/permissions`, {
        permissions: permissionsPayload,
      })
      // #region agent log
      fetch('http://127.0.0.1:7348/ingest/99aea8f7-ccdc-46d2-87be-cf18a1a897d9',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'420bea'},body:JSON.stringify({sessionId:'420bea',runId:'pre-fix',hypothesisId:'E',location:'PermissionsModal.jsx:handleSave:success',message:'patch succeeded',data:{status:res?.status,returnedId:res?.data?.id,returnedPermCount:Object.keys(res?.data?.permissions||{}).length},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      onSaved()
      onClose()
    } catch (err) {
      // #region agent log
      const detail = err.response?.data?.detail
      fetch('http://127.0.0.1:7348/ingest/99aea8f7-ccdc-46d2-87be-cf18a1a897d9',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'420bea'},body:JSON.stringify({sessionId:'420bea',runId:'pre-fix',hypothesisId:'A',location:'PermissionsModal.jsx:handleSave:catch',message:'save permissions failed',data:{status:err.response?.status??null,hasResponse:!!err.response,detailType:typeof detail,detailIsArray:Array.isArray(detail),detailPreview:typeof detail==='string'?detail.slice(0,200):Array.isArray(detail)?JSON.stringify(detail).slice(0,300):detail==null?null:String(detail).slice(0,200),code:err.code||null,errMessage:err.message||null},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      setError(err.response?.data?.detail || 'Failed to save permissions')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Permissions"
      size="md"
      footer={(
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} loading={saving} disabled={loading}>
            <ShieldCheck size={15} />
            Save Permissions
          </Button>
        </>
      )}
    >
      <p style={{ margin: '0 0 14px', fontSize: 13, color: tokens.textSecondary }}>
        {manager.full_name || manager.username} — controls which sections and actions are available in the manager panel.
      </p>

      {error && (
        <div style={{
          background: `${tokens.semantic.danger}18`,
          color: tokens.semantic.danger,
          padding: '8px 12px',
          borderRadius: 8,
          fontSize: 13,
          marginBottom: 12,
        }}
        >
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ padding: 24, textAlign: 'center', color: tokens.textSecondary, fontSize: 13 }}>
          Loading...
        </div>
      ) : (
        <div style={{
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          border: `1px solid ${tokens.border}`,
          borderRadius: 10,
          padding: 6,
        }}
        >
          {catalog.map((row) => (
            <div
              key={row.key}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '9px 10px',
                borderRadius: 8,
              }}
            >
              <Checkbox
                label={row.label || row.key}
                checked={!!checked[row.key]}
                onChange={() => toggle(row.key)}
              />
            </div>
          ))}
        </div>
      )}
    </Modal>
  )
}

export default PermissionsModal
