import { useEffect, useState } from 'react'
import api from '../../../api'
import { useTheme } from '../../../theme'
import {
  Card,
  Tabs,
  Button,
  Input,
  Select,
  Avatar,
  Skeleton,
} from '../../../shared/components'
import NotificationSettings from '../../../admin/pages/settings/NotificationSettings'
import { usePanelScope } from '../../hooks/usePanelScope'
import { useManagerScope } from '../../context/ManagerScopeContext'

const SETTINGS_TABS = [
  { id: 'profile', label: 'My Profile' },
  { id: 'workspace', label: 'Workspace' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'security', label: 'Security' },
]

const PROFILE_PREFS_KEY = 'ft.manager.profilePrefs'

const readProfilePrefs = () => {
  try {
    const raw = localStorage.getItem(PROFILE_PREFS_KEY)
    if (!raw) return { language: 'en', timezone: 'Asia/Karachi' }
    const parsed = JSON.parse(raw)
    return {
      language: parsed.language || 'en',
      timezone: parsed.timezone || 'Asia/Karachi',
    }
  } catch {
    return { language: 'en', timezone: 'Asia/Karachi' }
  }
}

const DashboardSettingsPanel = () => {
  const { tokens } = useTheme()
  const { managerId } = usePanelScope()
  const {
    managerName,
    assignedUserCount,
    totalVehicleCount,
    loading: scopeLoading,
  } = useManagerScope()

  const [tab, setTab] = useState('profile')
  const [detailLoading, setDetailLoading] = useState(true)
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [language, setLanguage] = useState(() => readProfilePrefs().language)
  const [timezone, setTimezone] = useState(() => readProfilePrefs().timezone)
  const [savingPrefs, setSavingPrefs] = useState(false)
  const [prefsSaved, setPrefsSaved] = useState(false)

  useEffect(() => {
    if (!managerId) {
      setDetailLoading(false)
      return undefined
    }
    let cancelled = false
    const load = async () => {
      try {
        const res = await api.get(`/api/managers/${managerId}`)
        if (cancelled) return
        const data = res.data || {}
        setFullName(data.full_name || data.username || '')
        setPhone(data.phone_number || '')
      } catch (err) {
        console.error('Failed to load manager profile:', err)
      } finally {
        if (!cancelled) setDetailLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [managerId])

  const displayName = fullName || managerName || 'Manager'

  const handleSaveProfilePrefs = () => {
    setSavingPrefs(true)
    setPrefsSaved(false)
    try {
      localStorage.setItem(PROFILE_PREFS_KEY, JSON.stringify({ language, timezone }))
      setPrefsSaved(true)
    } catch (err) {
      console.error('Failed to save profile prefs:', err)
    } finally {
      setSavingPrefs(false)
    }
  }

  return (
    <Card badge={11} title="Manager Settings">
      <Tabs items={SETTINGS_TABS} value={tab} onChange={setTab} style={{ marginBottom: 16 }} />

      {tab === 'profile' && (
        detailLoading ? (
          <div aria-hidden style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <Skeleton width={56} height={56} circle />
            <Skeleton height={38} />
            <Skeleton height={38} />
            <Skeleton height={38} width="70%" />
          </div>
        ) : (
          <>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 14,
                marginBottom: 18,
              }}
            >
              <Avatar name={displayName} size="xl" />
              <div>
                <div style={{ fontSize: 15, fontWeight: 700 }}>{displayName}</div>
                <div style={{ fontSize: 12, color: tokens.textMuted }}>Operations Manager</div>
              </div>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 12,
              }}
            >
              <Input
                label="Full Name"
                value={fullName}
                readOnly
                helperText="Managed by your administrator"
              />
              <Input
                label="Phone"
                value={phone}
                readOnly
                helperText="Managed by your administrator"
              />
              <Select
                label="Language"
                value={language}
                onChange={(e) => { setLanguage(e.target.value); setPrefsSaved(false) }}
              >
                <option value="en">English</option>
                <option value="ur">Urdu</option>
              </Select>
              <Select
                label="Timezone"
                value={timezone}
                onChange={(e) => { setTimezone(e.target.value); setPrefsSaved(false) }}
              >
                <option value="Asia/Karachi">Asia/Karachi (PKT)</option>
                <option value="UTC">UTC</option>
              </Select>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
              {prefsSaved && (
                <span style={{ fontSize: 12, color: tokens.semantic.success, fontWeight: 600 }}>
                  Preferences saved
                </span>
              )}
              <Button loading={savingPrefs} onClick={handleSaveProfilePrefs}>
                Save Changes
              </Button>
            </div>
          </>
        )
      )}

      {tab === 'workspace' && (
        scopeLoading ? (
          <div aria-hidden style={{ display: 'flex', gap: 12 }}>
            <Skeleton height={40} />
            <Skeleton height={40} />
            <Skeleton height={40} />
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, fontSize: 13 }}>
            <div>
              <div style={{ fontSize: 11, color: tokens.textMuted, fontWeight: 600 }}>WORKSPACE</div>
              <div style={{ fontWeight: 700, marginTop: 4 }}>{managerName || '—'}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: tokens.textMuted, fontWeight: 600 }}>VEHICLES</div>
              <div style={{ fontWeight: 700, marginTop: 4 }}>{totalVehicleCount ?? '—'}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: tokens.textMuted, fontWeight: 600 }}>USERS</div>
              <div style={{ fontWeight: 700, marginTop: 4 }}>{assignedUserCount ?? '—'}</div>
            </div>
          </div>
        )
      )}

      {tab === 'notifications' && <NotificationSettings />}

      {tab === 'security' && (
        <div style={{ fontSize: 13, color: tokens.textMuted }}>
          Password and session management are handled by your administrator.
        </div>
      )}
    </Card>
  )
}

export default DashboardSettingsPanel
