import React from 'react';
import { Navigate } from 'react-router-dom';
import useAuthStore from '../store/useAuthStore';

const ProtectedRoute = ({ children }) => {
  const { isAuthenticated, isCheckingAuth, token } = useAuthStore();

  // Block on spinner when:
  // - actively checking auth (async validation in flight), OR
  // - we have a stored token but isAuthenticated hasn't been confirmed yet
  //   (handles the brief hydration window on page refresh)
  if (!isAuthenticated && (isCheckingAuth || token)) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-[var(--bg)]">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-[var(--gold-acc)]/20 border-t-[var(--gold-acc)] rounded-full animate-spin" />
          <span className="text-[10px] font-black text-[var(--txt3)] uppercase tracking-[0.3em] animate-pulse">
            Verifying Neural Link
          </span>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  return children;
};

export default ProtectedRoute;
