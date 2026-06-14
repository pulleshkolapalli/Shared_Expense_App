import { useState } from 'react';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { ToastProvider } from './components/Toasts';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import GroupPage from './pages/GroupPage';

function AppContent() {
  const { user, loading } = useAuth();
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-sky-50 flex items-center justify-center">
        <div className="text-slate-400">Loading...</div>
      </div>
    );
  }

  if (!user) return <LoginPage />;

  if (selectedGroup) {
    return <GroupPage groupId={selectedGroup} onBack={() => setSelectedGroup(null)} />;
  }

  return <DashboardPage onSelectGroup={setSelectedGroup} />;
}

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <AppContent />
      </ToastProvider>
    </AuthProvider>
  );
}
