import React from 'react';
import useAuthStore from '../store/useAuthStore';

const API_BASE = (import.meta.env.VITE_API_URL || 'http://localhost:8000/api').replace('/api', '');

export const getInitials = (name) => {
  if (!name) return 'U';
  const parts = name.trim().split(' ');
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return parts[0][0].toUpperCase();
};

export default function UserAvatar({ className = '', style = {} }) {
  const user = useAuthStore((state) => state.user);
  
  const avatarUrl = user?.profile_pic 
    ? (user.profile_pic.startsWith('http') ? user.profile_pic : `${API_BASE}${user.profile_pic}`)
    : null;

  const defaultFallbackStyle = {
    background: 'linear-gradient(135deg, #4F46E5, #7C3AED)',
    color: '#FFFFFF',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: '600',
    ...style
  };

  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={user?.name || 'User Avatar'}
        className={className}
        style={{ objectFit: 'cover', ...style }}
      />
    );
  }

  return (
    <div className={className} style={defaultFallbackStyle}>
      {getInitials(user?.name)}
    </div>
  );
}
