import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import Login from "./auth/Login";
import Dashboard from "./pages/Dashboard";
import ProjektDetail from "./pages/ProjektDetail";
import ProcessModelEditor from "./pages/ProcessModelEditor";
import ProcessModelList from "./pages/ProcessModelList";
import TaskCalendar from "./pages/TaskCalendar";
import UsersPage from "./pages/UsersPage";
import PrivateRoute from "./routes/PrivateRoute";
import AdminRoute from "./routes/AdminRoute";
import AuditLogViewer from "./pages/AuditLogViewer";
import StructureTimelinePage from "./pages/StructureTimeline";
import ProjectTasksTable from "./pages/ProjectTasksTable";

import { useEffect } from "react";
import { LoadingProvider, useLoading } from "./context/LoadingContext";
import LoadingOverlay from "./components/LoadingOverlay";
import { loaderBridge } from "./api/axios"; // ↓ vidi axios.ts

// Mali helper koji “spaja” axios interceptore s globalnim loaderom
function LoaderBridgeHook() {
  const { show, hide } = useLoading();
  useEffect(() => {
    loaderBridge.show = show;
    loaderBridge.hide = hide;
    return () => {
      loaderBridge.show = undefined;
      loaderBridge.hide = undefined;
    };
  }, [show, hide]);
  return null;
}

function AppRoutes() {
  return (
    <Routes>
      {/* Public */}
      <Route path="/" element={<Login />} />

      {/* Authenticated (sve uloge) */}
      <Route
        path="/dashboard"
        element={
          <PrivateRoute>
            <Dashboard />
          </PrivateRoute>
        }
      />
      <Route
        path="/projekt/:id"
        element={
          <PrivateRoute>
            <ProjektDetail />
          </PrivateRoute>
        }
      />
      <Route
        path="/projekt/:id/timeline"
        element={
          <PrivateRoute>
            <TaskCalendar />
          </PrivateRoute>
        }
      />

      {/* Admin-only */}
      <Route
        path="/users"
        element={
          <AdminRoute>
            <UsersPage />
          </AdminRoute>
        }
      />
      <Route
        path="/prozessmodell"
        element={
          <AdminRoute>
            <ProcessModelEditor />
          </AdminRoute>
        }
      />
      <Route
        path="/prozessmodell/:id"
        element={
          <AdminRoute>
            <ProcessModelEditor />
          </AdminRoute>
        }
      />
      <Route
        path="/prozessmodelle"
        element={
          <AdminRoute>
            <ProcessModelList />
          </AdminRoute>
        }
      />
      <Route path="/audit" element={<AuditLogViewer />} />
      <Route
        path="/projekt/:projectId/struktur-timeline"
        element={<StructureTimelinePage />}
      />
      <Route
        path="/projekt/:id/tasks-tabelle"
        element={<ProjectTasksTable />}
      />
    </Routes>
  );
}

export default function App() {
  return (
    <LoadingProvider>
      <Router>
        {/* <LoaderBridgeHook /> */}
        <AppRoutes />
        {/* Overlay na dnu da bude uvijek iznad svega */}
        {/* <LoadingOverlay /> */}
      </Router>
    </LoadingProvider>
  );
}
