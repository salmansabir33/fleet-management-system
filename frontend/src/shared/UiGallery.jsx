import { useState } from 'react'
import {
  Bell, Car, Pencil, Plus, Trash2, Wrench,
} from 'lucide-react'
import { useTheme } from '../theme'
import {
  Avatar,
  Badge,
  Button,
  Card,
  Checkbox,
  ConfirmDialog,
  Dropdown,
  DropdownItem,
  EmptyState,
  FilterBar,
  IconButton,
  Input,
  LoadingState,
  MaintenanceBadge,
  Modal,
  PageHeader,
  Pagination,
  SearchInput,
  SectionHeader,
  Select,
  SeverityBadge,
  Skeleton,
  StatCard,
  StatusBadge,
  Switch,
  Table,
  TableRow,
  Tabs,
  Toast,
  Tooltip,
} from './components'

const THEME_LOCKED = {
  moving: '#0d9488',
  critical: '#dc2626',
  overdue: '#dc2626',
}

const SAMPLE_ROWS = [
  { id: 1, name: 'Truck 12', driver: 'Ali', status: 'moving' },
  { id: 2, name: 'Van 4', driver: 'Sara', status: 'idle' },
  { id: 3, name: 'Bike 9', driver: '—', status: 'offline' },
]

// Temporary kitchen-sink at /dev/ui — remove once page batches land.
const UiGallery = () => {
  const { themeId, setTheme, availableThemes, tokens } = useTheme()
  const [tab, setTab] = useState('overview')
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [checked, setChecked] = useState(true)
  const [toggled, setToggled] = useState(true)
  const [page, setPage] = useState(2)
  const [modalOpen, setModalOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [toastOpen, setToastOpen] = useState(false)
  const [loadingBtn, setLoadingBtn] = useState(false)

  return (
    <div style={{ minHeight: '100vh', background: tokens.background, color: tokens.text, padding: 28, paddingBottom: 112 }}>
      <div style={{ maxWidth: 1080, margin: '0 auto' }}>
        <PageHeader
          title="Shared UI gallery"
          subtitle="Temporary /dev/ui — switch all 6 themes. Accent (buttons, focus, tabs, avatars) should change; status/severity must not."
          actions={(
            <span style={{ fontSize: 12, color: tokens.textMuted }}>
              Active: <strong style={{ color: tokens.primary }}>{themeId}</strong>
            </span>
          )}
        />

        <Card style={{ marginBottom: 20 }}>
          <SectionHeader title="Theme" subtitle="Brand slice only" />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
            {availableThemes.map((theme) => (
              <Button
                key={theme.id}
                variant={theme.id === themeId ? 'primary' : 'secondary'}
                size="sm"
                onClick={() => setTheme(theme.id)}
              >
                {theme.name}
              </Button>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
            <Swatch label="primary (brand)" color={tokens.primary} />
            <Swatch label="moving (locked)" color={tokens.fleetStatus.moving} locked={tokens.fleetStatus.moving === THEME_LOCKED.moving} />
            <Swatch label="critical (locked)" color={tokens.alertSeverity.critical} locked={tokens.alertSeverity.critical === THEME_LOCKED.critical} />
            <Swatch label="overdue (locked)" color={tokens.maintenanceState.overdue} locked={tokens.maintenanceState.overdue === THEME_LOCKED.overdue} />
          </div>
        </Card>

        <SectionHeader title="Cards & stats" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 20 }}>
          <Card title="Static card">
            <p style={{ margin: 0, fontSize: 13, color: tokens.textMuted }}>No hover lift.</p>
          </Card>
          <Card title="Interactive" interactive>
            <p style={{ margin: 0, fontSize: 13, color: tokens.textMuted }}>Hover to lift.</p>
          </Card>
          <StatCard icon={Car} label="Total vehicles" value="42" trend={{ direction: 'up', label: '+3' }} />
          <StatCard icon={Bell} label="Critical today" value="5" tone="danger" trend={{ direction: 'down', label: '−1' }} />
          <StatCard icon={Wrench} label="Due maintenance" value="8" tone="warning" />
        </div>

        <SectionHeader title="Buttons" />
        <Card style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <Button>Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="danger">Danger</Button>
            <Button variant="ghost">Ghost</Button>
            <Button
              loading={loadingBtn}
              onClick={() => {
                setLoadingBtn(true)
                setTimeout(() => setLoadingBtn(false), 1200)
              }}
            >
              Save
            </Button>
            <Button disabled>Disabled</Button>
            <Tooltip content="Edit">
              <IconButton label="Edit"><Pencil size={15} /></IconButton>
            </Tooltip>
            <IconButton label="Add" variant="primary"><Plus size={16} /></IconButton>
            <IconButton label="Delete" variant="danger"><Trash2 size={15} /></IconButton>
          </div>
        </Card>

        <SectionHeader title="Badges (semantic — must not follow brand)" />
        <Card style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', marginBottom: 12 }}>
            <StatusBadge status="moving" />
            <StatusBadge status="idle" />
            <StatusBadge status="stopped" />
            <StatusBadge status="offline" />
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 12 }}>
            <SeverityBadge severity="critical" />
            <SeverityBadge severity="warning" />
            <SeverityBadge severity="info" />
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <MaintenanceBadge status="ok" />
            <MaintenanceBadge status="due_soon" />
            <MaintenanceBadge status="overdue" />
            <MaintenanceBadge status="no_baseline" />
            <Badge color={tokens.semantic.neutral} background={tokens.background}>Neutral</Badge>
          </div>
        </Card>

        <SectionHeader title="Forms, search, filters, tabs" />
        <Card style={{ marginBottom: 20 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14, marginBottom: 16 }}>
            <Input label="Vehicle name" placeholder="Truck 12" helperText="Shown on the live map" />
            <Input label="Plate" error="Plate is required" />
            <Select label="Vehicle type" defaultValue="truck">
              <option value="truck">Truck</option>
              <option value="van">Van</option>
              <option value="car">Car</option>
            </Select>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center', marginBottom: 16 }}>
            <Checkbox label="Show resolved" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
            <Switch label="Notifications on" checked={toggled} onChange={(e) => setToggled(e.target.checked)} />
            <SearchInput
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search vehicle, plate, or driver..."
              style={{ minWidth: 260 }}
            />
          </div>
          <FilterBar
            value={filter}
            onChange={setFilter}
            options={[
              { key: 'all', label: 'All', count: 12 },
              { key: 'moving', label: 'Moving', count: 5 },
              { key: 'idle', label: 'Idle', count: 3 },
              { key: 'offline', label: 'Offline', count: 4 },
            ]}
          />
          <div style={{ marginTop: 16 }}>
            <Tabs
              value={tab}
              onChange={setTab}
              items={[
                { id: 'overview', label: 'Overview' },
                { id: 'trips', label: 'Trips' },
                { id: 'alerts', label: 'Alerts' },
              ]}
            />
          </div>
        </Card>

        <SectionHeader title="Table, pagination, avatar" />
        <Card style={{ marginBottom: 20, padding: 0 }}>
          <Table
            columns={[
              { key: 'name', label: 'Vehicle' },
              { key: 'driver', label: 'Driver' },
              { key: 'status', label: 'Status' },
            ]}
          >
            {SAMPLE_ROWS.map((row) => (
              <TableRow key={row.id} onClick={() => {}}>
                <td>{row.name}</td>
                <td>{row.driver}</td>
                <td><StatusBadge status={row.status} /></td>
              </TableRow>
            ))}
            <TableRow>
              <td colSpan={3} style={{ color: tokens.textMuted }}>Non-clickable row (default cursor)</td>
            </TableRow>
          </Table>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 12 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <Avatar name="Ali Khan" />
              <Avatar name="Sara" size="lg" />
            </div>
            <Pagination page={page} pageCount={12} onPageChange={setPage} />
          </div>
        </Card>

        <SectionHeader title="Overlay: modal, confirm, dropdown, toast" />
        <Card style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <Button onClick={() => setModalOpen(true)}>Open modal</Button>
            <Button variant="danger" onClick={() => setConfirmOpen(true)}>Confirm delete</Button>
            <Button variant="secondary" onClick={() => setToastOpen(true)}>Show toast</Button>
            <Dropdown trigger={<Button variant="secondary">Actions</Button>}>
              <DropdownItem onClick={() => {}}>Edit vehicle</DropdownItem>
              <DropdownItem danger onClick={() => setConfirmOpen(true)}>
                <Trash2 size={14} /> Delete
              </DropdownItem>
            </Dropdown>
          </div>
        </Card>

        <SectionHeader title="Bottom nav (temporary preview — remove later)" />
        <Card style={{ marginBottom: 20 }}>
          <p style={{ margin: '0 0 10px', fontSize: 13, color: tokens.textMuted }}>
            Temporary. The bar is fixed to the viewport bottom. Tap More (or the button) to open the drop-up sheet.
          </p>
          <Button variant="secondary" size="sm" onClick={() => setBottomMoreOpen(true)}>
            Open more sheet
          </Button>
        </Card>

        <SectionHeader title="Empty / loading / skeleton" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12, marginBottom: 40 }}>
          <Card>
            <EmptyState
              icon={Car}
              title="No vehicles match"
              description="Try a different status filter or search term."
              action={<Button size="sm">Add vehicle</Button>}
            />
          </Card>
          <Card>
            <LoadingState label="Loading dashboard..." />
          </Card>
          <Card>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <Skeleton height={16} width="60%" />
              <Skeleton height={12} />
              <Skeleton height={12} width="80%" />
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <Skeleton circle width={32} height={32} />
                <Skeleton height={12} width="40%" />
              </div>
            </div>
          </Card>
        </div>
      </div>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Vehicle details"
        footer={(
          <>
            <Button variant="secondary" onClick={() => setModalOpen(false)}>Close</Button>
            <Button onClick={() => setModalOpen(false)}>Save</Button>
          </>
        )}
      >
        <p style={{ margin: 0, fontSize: 14, color: tokens.textSecondary }}>
          Backdrop fades; panel scales in. Primary actions follow the active theme; status badges do not.
        </p>
        <div style={{ marginTop: 12 }}><StatusBadge status="moving" /></div>
      </Modal>

      <ConfirmDialog
        open={confirmOpen}
        title="Delete vehicle?"
        message="This cannot be undone."
        confirmLabel="Delete"
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => setConfirmOpen(false)}
      />

      <Toast open={toastOpen} variant="success" onClose={() => setToastOpen(false)}>
        Settings saved
      </Toast>
    </div>
  )
}

const Swatch = ({ label, color, locked }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
    <span style={{ width: 28, height: 28, borderRadius: 8, background: color, flexShrink: 0, border: '1px solid var(--ft-border)' }} />
    <div>
      <div style={{ fontSize: 12, fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 11, color: 'var(--ft-text-muted)', fontFamily: 'ui-monospace, monospace' }}>
        {color}{locked ? ' · lock ok' : locked === false ? ' · DRIFT' : ''}
      </div>
    </div>
  </div>
)

export default UiGallery
