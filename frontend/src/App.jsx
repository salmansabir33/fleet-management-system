import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Login from './pages/Login'
import AdminLogin from './pages/AdminLogin'

import { ThemeProvider } from './theme'
import UiGallery from './shared/UiGallery'
import { AuthProvider } from './auth/AuthContext'
import ProtectedRoute from './auth/ProtectedRoute'
import { LoadingState } from './shared/components'

import { CurrentUserProvider } from './user/context/CurrentUserContext'
import { SelectedDeviceProvider } from './user/context/SelectedDeviceContext'
import UserLayout from './user/components/UserLayout'
import VehiclePicker from './user/pages/VehiclePicker'
import Dashboard from './user/pages/Dashboard'
import TripRoutes from './user/pages/TripRoutes'
import Alerts from './user/pages/Alerts'
import Playback from './user/pages/Playback'
import UserSettings from './user/pages/UserSettings'

import AdminLayout from './admin/components/AdminLayout'
import SuperAdminLayout from './super-admin/components/SuperAdminLayout'
import SuperAdminAdmins from './super-admin/pages/Admins'
import SuperAdminUnassigned from './super-admin/pages/Unassigned'
import SuperAdminEnterFleet from './super-admin/pages/EnterFleet'
import AdminDashboard from './admin/pages/AdminDashboard'
import AllVehicles from './admin/pages/AllVehicles'
import AdminVehicleDetail from './admin/pages/AdminVehicleDetail'
import AdminMaintenanceVehicles from './admin/pages/AdminMaintenanceVehicles'
import AllUsers from './admin/pages/AllUsers'
import UserDetail from './admin/pages/UserDetail'
import Managers from './admin/pages/Managers'
import AdminTrips from './admin/pages/AdminTrips'
import AdminDrivers from './admin/pages/Drivers'
import AdminDriverDetail from './admin/pages/AdminDriverDetail'
import AdminRoutes from './admin/pages/Routes'
import AdminGeofences from './admin/pages/Geofences'
import Settings from './admin/pages/Settings'
import AdminNotificationsPage from './admin/pages/AdminNotificationsPage'
import AdminMap from './admin/pages/AdminMap'

import ManagerPicker from './manager/pages/ManagerPicker'
import ManagerLayout from './manager/components/ManagerLayout'
import ManagerSettings from './manager/pages/ManagerSettings'
import ManagerDashboard from './manager/pages/ManagerDashboard'
import ManagerAssetPicker from './manager/pages/ManagerAssetPicker'
import ManagerAlerts from './manager/pages/ManagerAlerts'
import ManagerPlaybackHub from './manager/pages/ManagerPlaybackHub'
import ManagerMap from './manager/pages/ManagerMap'
import PermissionGate from './manager/components/PermissionGate'
import UserPermissionGate from './user/components/PermissionGate'
import UserMap from './user/pages/UserMap'

const MyVehicle = lazy(() => import('./user/pages/MyVehicle'))
const MaintenanceVehicleLayout = lazy(() => import('./admin/pages/MaintenanceVehicleLayout'))
const MaintenanceIndex = lazy(() => import('./user/pages/MaintenanceIndex'))
const MaintenanceBaseline = lazy(() => import('./user/pages/MaintenanceBaseline'))
const Maintenance = lazy(() => import('./user/pages/Maintenance'))
const MaintenanceReport = lazy(() => import('./user/pages/MaintenanceReport'))

const MaintenanceFallback = (
  <LoadingState label="Loading maintenance…" />
)

const withMaintenanceSuspense = (element) => (
  <Suspense fallback={MaintenanceFallback}>{element}</Suspense>
)

const App = () => {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <CurrentUserProvider>
            <SelectedDeviceProvider>
              <Routes>
                <Route path="/login" element={<Login />} />
                <Route path="/admin/login" element={<AdminLogin />} />
                <Route path="/" element={<Navigate to="/login" replace />} />

                <Route path="/dev/ui" element={<UiGallery />} />

                <Route path="/user" element={(
                  <ProtectedRoute roles={['user', 'manager']}>
                    <UserLayout />
                  </ProtectedRoute>
                )}>
                  <Route path="vehicles" element={<VehiclePicker />} />
                  <Route index element={<Dashboard />} />
                  <Route path="dashboard" element={<Dashboard />} />
                  <Route path="my-vehicle" element={(
                    <UserPermissionGate requires="live_tracking">
                      <Suspense fallback={<LoadingState label="Loading vehicle…" />}>
                        <MyVehicle />
                      </Suspense>
                    </UserPermissionGate>
                  )}
                  />
                  <Route path="trip-routes" element={<UserPermissionGate requires="trip_history"><TripRoutes /></UserPermissionGate>} />
                  <Route path="alerts" element={<UserPermissionGate requires="alerts_notifications"><Alerts /></UserPermissionGate>} />
                  <Route path="playback" element={<UserPermissionGate requires="trip_history"><Playback /></UserPermissionGate>} />
                  <Route path="map" element={<UserPermissionGate requires="live_tracking"><UserMap /></UserPermissionGate>} />
                  <Route path="maintenance" element={(
                    <UserPermissionGate requires="maintenance">
                      {withMaintenanceSuspense(<MaintenanceVehicleLayout />)}
                    </UserPermissionGate>
                  )}
                  >
                    <Route index element={withMaintenanceSuspense(<MaintenanceIndex />)} />
                    <Route path="baseline" element={withMaintenanceSuspense(<MaintenanceBaseline />)} />
                    <Route path="entry" element={withMaintenanceSuspense(<Maintenance />)} />
                    <Route path="report" element={withMaintenanceSuspense(<MaintenanceReport />)} />
                  </Route>
                  <Route path="settings" element={<UserSettings />} />
                </Route>

                <Route path="/super-admin" element={(
                  <ProtectedRoute roles={['super_admin']}>
                    <SuperAdminLayout />
                  </ProtectedRoute>
                )}>
                  <Route index element={<AdminDashboard />} />
                  <Route path="dashboard" element={<AdminDashboard />} />
                  <Route path="vehicles" element={<AllVehicles />} />
                  <Route path="vehicles/:deviceId" element={<AdminVehicleDetail />} />
                  <Route path="map" element={<AdminMap />} />
                  <Route path="playback" element={<ManagerPlaybackHub />} />
                  <Route path="playback/:deviceId" element={<Playback />} />
                  <Route path="maintenance" element={<AdminMaintenanceVehicles />} />
                  <Route path="maintenance/:vehicleId" element={withMaintenanceSuspense(<MaintenanceVehicleLayout />)}>
                    <Route index element={withMaintenanceSuspense(<MaintenanceIndex />)} />
                    <Route path="baseline" element={withMaintenanceSuspense(<MaintenanceBaseline />)} />
                    <Route path="entry" element={withMaintenanceSuspense(<Maintenance />)} />
                    <Route path="report" element={withMaintenanceSuspense(<MaintenanceReport />)} />
                  </Route>
                  <Route path="managers" element={<Managers />} />
                  <Route path="trips" element={<AdminTrips />} />
                  <Route path="users" element={<AllUsers />} />
                  <Route path="users/:userId" element={<UserDetail />} />
                  <Route path="geofences" element={<AdminGeofences />} />
                  <Route path="drivers" element={<AdminDrivers />} />
                  <Route path="drivers/:driverId" element={<AdminDriverDetail />} />
                  <Route path="drivers/:driverId/history" element={<AdminDriverDetail />} />
                  <Route path="routes" element={<AdminRoutes />} />
                  <Route path="notifications" element={<AdminNotificationsPage />} />
                  <Route path="settings" element={<Settings />} />
                  <Route path="admins" element={<SuperAdminAdmins />} />
                  <Route path="unassigned" element={<SuperAdminUnassigned />} />
                  <Route path="enter-fleet" element={<SuperAdminEnterFleet />} />
                </Route>

                <Route path="/admin" element={(
                  <ProtectedRoute roles={['admin']}>
                    <AdminLayout />
                  </ProtectedRoute>
                )}>
                  <Route index element={<AdminDashboard />} />
                  <Route path="dashboard" element={<AdminDashboard />} />
                  <Route path="vehicles" element={<AllVehicles />} />
                  <Route path="vehicles/:deviceId" element={<AdminVehicleDetail />} />
                  <Route path="map" element={<AdminMap />} />
                  <Route path="playback" element={<ManagerPlaybackHub />} />
                  <Route path="playback/:deviceId" element={<Playback />} />
                  <Route path="maintenance" element={<AdminMaintenanceVehicles />} />
                  <Route path="maintenance/:vehicleId" element={withMaintenanceSuspense(<MaintenanceVehicleLayout />)}>
                    <Route index element={withMaintenanceSuspense(<MaintenanceIndex />)} />
                    <Route path="baseline" element={withMaintenanceSuspense(<MaintenanceBaseline />)} />
                    <Route path="entry" element={withMaintenanceSuspense(<Maintenance />)} />
                    <Route path="report" element={withMaintenanceSuspense(<MaintenanceReport />)} />
                  </Route>
                  <Route path="managers" element={<Managers />} />
                  <Route path="trips" element={<AdminTrips />} />
                  <Route path="users" element={<AllUsers />} />
                  <Route path="users/:userId" element={<UserDetail />} />
                  <Route path="geofences" element={<AdminGeofences />} />
                  <Route path="drivers" element={<AdminDrivers />} />
                  <Route path="drivers/:driverId" element={<AdminDriverDetail />} />
                  <Route path="drivers/:driverId/history" element={<AdminDriverDetail />} />
                  <Route path="routes" element={<AdminRoutes />} />
                  <Route path="notifications" element={<AdminNotificationsPage />} />
                  <Route path="settings" element={<Settings />} />
                </Route>

                <Route path="/manager/select" element={(
                  <ProtectedRoute roles={['admin', 'super_admin']}>
                    <ManagerPicker />
                  </ProtectedRoute>
                )} />
                <Route path="/manager/:managerId" element={(
                  <ProtectedRoute roles={['manager', 'admin', 'super_admin']}>
                    <ManagerLayout />
                  </ProtectedRoute>
                )}>
                  <Route index element={<ManagerDashboard />} />
                  <Route path="dashboard" element={<ManagerDashboard />} />
                  <Route path="picker" element={<PermissionGate requires="live_tracking"><ManagerAssetPicker /></PermissionGate>} />
                  <Route path="vehicles" element={<PermissionGate requires="live_tracking"><AllVehicles /></PermissionGate>} />
                  <Route path="vehicles/:deviceId" element={<PermissionGate requires="live_tracking"><AdminVehicleDetail /></PermissionGate>} />
                  <Route path="map" element={<PermissionGate requires="live_tracking"><ManagerMap /></PermissionGate>} />
                  <Route path="playback" element={<PermissionGate requires="live_tracking"><ManagerPlaybackHub /></PermissionGate>} />
                  <Route path="playback/:deviceId" element={<Playback />} />
                  <Route path="alerts" element={<PermissionGate requires="alerts_notifications"><ManagerAlerts /></PermissionGate>} />
                  <Route path="maintenance" element={<PermissionGate requires="maintenance"><AdminMaintenanceVehicles /></PermissionGate>} />
                  <Route path="maintenance/:vehicleId" element={(
                    <PermissionGate requires="maintenance">
                      {withMaintenanceSuspense(<MaintenanceVehicleLayout />)}
                    </PermissionGate>
                  )}
                  >
                    <Route index element={withMaintenanceSuspense(<MaintenanceIndex />)} />
                    <Route path="baseline" element={withMaintenanceSuspense(<MaintenanceBaseline />)} />
                    <Route path="entry" element={withMaintenanceSuspense(<Maintenance />)} />
                    <Route path="report" element={withMaintenanceSuspense(<MaintenanceReport />)} />
                  </Route>
                  <Route path="users" element={<PermissionGate requires="user_management"><AllUsers /></PermissionGate>} />
                  <Route path="users/:userId" element={<PermissionGate requires="user_management"><UserDetail /></PermissionGate>} />
                  <Route path="drivers" element={<PermissionGate requires="driver_management"><AdminDrivers /></PermissionGate>} />
                  <Route path="drivers/:driverId" element={<PermissionGate requires="driver_management"><AdminDriverDetail /></PermissionGate>} />
                  <Route path="drivers/:driverId/history" element={<PermissionGate requires="driver_management"><AdminDriverDetail /></PermissionGate>} />
                  <Route path="routes" element={<PermissionGate requires="route_management"><AdminRoutes /></PermissionGate>} />
                  <Route path="trips" element={<PermissionGate requires="trip_history"><AdminTrips /></PermissionGate>} />
                  <Route path="geofences" element={<PermissionGate requires="geofence"><AdminGeofences /></PermissionGate>} />
                  <Route path="settings" element={<ManagerSettings />} />
                </Route>

                <Route path="*" element={<Navigate to="/login" replace />} />
              </Routes>
            </SelectedDeviceProvider>
          </CurrentUserProvider>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  )
}

export default App
