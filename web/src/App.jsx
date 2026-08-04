import { BrowserRouter, Routes, Route } from 'react-router-dom';
import AdminLayout from './AdminLayout.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import ProjectPage from './pages/ProjectPage.jsx';
import QueryPage from './pages/QueryPage.jsx';
import SharePage from './pages/SharePage.jsx';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/s/:token" element={<SharePage />} />
        <Route element={<AdminLayout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/projects/:id" element={<ProjectPage />} />
          <Route path="/queries/:id" element={<QueryPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
