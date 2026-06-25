import React, { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import useThemeStore from './store/useThemeStore';
import useAuthStore from './store/useAuthStore';
import ProtectedRoute from './components/ProtectedRoute';
import Landing from './pages/Landing';
import PharmaAIPage from './pages/PharmaAIPage';

export default function App() {
  const loadTheme      = useThemeStore((s) => s.loadTheme);
  const checkAuth      = useAuthStore((s) => s.checkAuth);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  useEffect(() => {
    loadTheme();
    checkAuth();
  }, [loadTheme, checkAuth]);

  return (
    <>
      <Toaster
        position="bottom-right"
        gutter={8}
        containerStyle={{ position: 'fixed', bottom: '20px', right: '16px', top: 'auto', left: 'auto', zIndex: 99999 }}
        toastOptions={{
          duration: 3000,
          style: {
            fontFamily:           'Inter, system-ui, sans-serif',
            fontSize:             '0.8125rem',
            fontWeight:           '500',
            lineHeight:           '1.45',
            padding:              '10px 14px',
            borderRadius:         '10px',
            maxWidth:             '300px',
            minWidth:             '220px',
            background:           'rgba(18,17,24,0.95)',
            color:                '#E8E8F0',
            border:               '1px solid rgba(255,255,255,0.09)',
            boxShadow:            '0 8px 32px rgba(0,0,0,0.50)',
            backdropFilter:       'blur(18px)',
            WebkitBackdropFilter: 'blur(18px)',
          },
          success: {
            duration:  2500,
            iconTheme: { primary: '#3B82F6', secondary: '#0B0B0F' },
            style: {
              border:    '1px solid rgba(59,130,246,0.35)',
              boxShadow: '0 8px 32px rgba(0,0,0,0.50), 0 0 0 1px rgba(59,130,246,0.08) inset',
            },
          },
          error: {
            duration:  4000,
            iconTheme: { primary: '#F87171', secondary: '#1A1A1F' },
            style: {
              border:    '1px solid rgba(248,113,113,0.35)',
              boxShadow: '0 8px 32px rgba(0,0,0,0.50), 0 0 0 1px rgba(248,113,113,0.08) inset',
            },
          },
        }}
      />

      <Routes>
        <Route path="/" element={isAuthenticated ? <Navigate to="/ai" replace /> : <Landing />} />

        <Route
          path="/ai"
          element={
            <ProtectedRoute>
              <PharmaAIPage />
            </ProtectedRoute>
          }
        />

        {/* All other paths redirect to root */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
