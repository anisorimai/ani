import React, { useState } from 'react';
import { toast } from 'react-hot-toast';
import useChatStore from '../store/useChatStore';
import {
  HiOutlinePlus, HiOutlineTrash, HiOutlineChatAlt2,
  HiOutlineX, HiOutlineCog, HiOutlineDocumentAdd,
  HiOutlinePencil, HiCheck, HiOutlineRefresh, HiOutlineLogout
} from 'react-icons/hi';
import useAuthStore from '../store/useAuthStore';
import CustomDropdown from './CustomDropdown';
import ConfirmModal from './ConfirmModal';
import UserAvatar from './UserAvatar';
import DocumentUpload from './DocumentUpload';
// import MedicineManager from './MedicineManager';
import AppLogo from './AppLogo';
// import { clearServerCache } from '../services/api';

export default function Sidebar({ isOpen, onClose, onNavigateToChat }) {
  /* ── Store selectors ── */
  const conversations = useChatStore((s) => s.conversations);
  const activeId = useChatStore((s) => s.activeConversationId);
  const setActive = useChatStore((s) => s.setActiveConversation);
  const newChat = useChatStore((s) => s.newChat);
  const deleteConv = useChatStore((s) => s.deleteConversation);
  const renameConv = useChatStore((s) => s.renameConversation);
  const clearAll = useChatStore((s) => s.clearAll);
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  const isAdmin = user?.role === 'admin';

  /* ── Local UI state ── */
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [clearingCache, setClearingCache] = useState(false);
  const [micInput, setMicInput] = useState('default');
  const [deleteTarget, setDeleteTarget] = useState(null);  // conv id awaiting delete confirm
  const [clearModal, setClearModal] = useState(false);
  const [docsOpen, setDocsOpen] = useState(false);
  // const [medicineOpen, setMedicineOpen] = useState(false);
  
  // Renaming state
  const [editingId, setEditingId] = useState(null);
  const [editTitle, setEditTitle] = useState('');

  /* ── Sorted conversations (newest first) ── */
  const sorted = Object.values(conversations).sort((a, b) => b.updatedAt - a.updatedAt);

  /* ─────────────────────────────────────────────
   * handleSelect: switches to a conversation
   * ───────────────────────────────────────────── */
  const handleSelect = (id) => {
    if (editingId === id) return;
    setActive(id);
    onNavigateToChat?.();
  };

  /* Confirm single conversation delete */
  const confirmDelete = () => {
    deleteConv(deleteTarget);
    toast.success('Conversation deleted');
    setDeleteTarget(null);
  };

  /* Rename conversation */
  const handleRenameStart = (e, id, currentTitle) => {
    e.stopPropagation();
    setEditingId(id);
    setEditTitle(currentTitle);
  };

  const handleRenameSubmit = () => {
    const id = editingId;
    const title = editTitle.trim();
    
    // Reset editing state first to close the input UI immediately
    setEditingId(null);
    setEditTitle('');

    if (title && id && conversations[id]) {
      if (conversations[id].title !== title) {
        renameConv(id, title);
        toast.success('Chat renamed');
      }
    }
  };

  const handleRenameKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      handleRenameSubmit();
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setEditingId(null);
    }
  };

  /* Confirm wipe of all conversations */
  const confirmClear = () => {
    if (clearAll) {
      clearAll();
    } else {
      Object.keys(conversations).forEach((id) => deleteConv(id));
      setActive(null);
    }
    toast.success('All conversations cleared');
    setSettingsOpen(false);
    setClearModal(false);
  };

  /* Start a new chat */
  const handleNewChat = () => {
    newChat();
    onNavigateToChat?.();
  };

  /* Clear server-side DB result cache (admin only) */
  // const handleClearCache = async () => {
  //   setClearingCache(true);
  //   try {
  //     const result = await clearServerCache();
  //     toast.success(`Cache cleared — ${result.entries_removed} entries removed`);
  //   } catch {
  //     toast.error('Failed to clear cache');
  //   } finally {
  //     setClearingCache(false);
  //   }
  // };



  /* ── Group conversations by relative date label ── */
  const fmt = (ts) => {
    const days = Math.floor((Date.now() - ts) / 86400000);
    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days} days ago`;
    return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const grouped = sorted.reduce((acc, c) => {
    const k = fmt(c.updatedAt);
    (acc[k] = acc[k] || []).push(c);
    return acc;
  }, {});

  /* First letter of user name for avatar */
  const initial = (user?.name?.[0] || 'U').toUpperCase();

  return (
    <>
      {/*
        Backdrop — dimmed overlay behind the sidebar.
        Clicking it closes the sidebar.
        Only rendered on mobile (sm:hidden hides it on desktop).
      */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-[90] md:hidden animate-fade-in"
          onClick={onClose}
        />
      )}

      {/*
        Sidebar panel.
        Uses .sidebar-panel class which reads --sb-* CSS variables,
        so background / border / text colour all follow the active theme.
        Width is fixed at 240px — enough space for titles without crowding.
      */}
      <aside
        id="sidebar"
        className={`
          fixed left-0 top-0 bottom-0 z-[100]
          w-[240px] flex flex-col
          sidebar-panel
          transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]
          ${isOpen ? 'translate-x-0' : '-translate-x-full'}
        `}
      >
        {/* ── Header: logo + close button ── */}
        <div
          className="flex items-center justify-between px-4 h-20 flex-shrink-0"
          style={{ borderBottom: '1px solid var(--sb-brd)' }}
        >
          <div className="flex items-center gap-2">
            <AppLogo size={60} className="rounded-sm" />
            <span
              className="text-[0.875rem] font-semibold tracking-tight"
              style={{ color: 'var(--sb-txt)' }}
            >
              Voxa
            </span>
          </div>

          {/* Close sidebar button */}
          <button
            className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors duration-150"
            style={{ color: 'var(--sb-txt2)' }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--sb-hover)'; e.currentTarget.style.color = 'var(--sb-txt)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--sb-txt2)'; }}
            onClick={onClose}
            aria-label="Close sidebar"
          >
            <HiOutlineX size={16} />
          </button>
        </div>

        {/* ── Documents button ── */}
        <div className="px-3 py-2.5 flex-shrink-0 flex flex-col gap-1.5">
          <button
            className="ci-sidebar-btn flex items-center gap-2 px-3 py-2 rounded-lg w-full transition-all duration-150 text-left"
            style={{ color: 'var(--sb-txt2)' }}
            onMouseEnter={e => {
              e.currentTarget.style.borderColor = 'color-mix(in srgb, var(--ci-primary-solid) 45%, transparent)';
              e.currentTarget.style.color = 'var(--sb-txt)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.borderColor = 'var(--sb-brd)';
              e.currentTarget.style.color = 'var(--sb-txt2)';
            }}
            onClick={() => setDocsOpen(true)}
          >
            <HiOutlineDocumentAdd size={16} style={{ color: 'var(--ci-primary-solid)', flexShrink: 0 }} />
            <span className="text-[0.8125rem] font-medium">Documents</span>
          </button>
        </div>



        {/* ── Scrollable conversation list ── */}
        <div className="flex-1 overflow-y-auto px-2 pb-2 min-h-0">
          {sorted.length === 0 ? (
            /* Empty state */
            <div
              className="flex flex-col items-center justify-center py-8 px-3 text-center gap-2"
              style={{ color: 'var(--sb-txt3)' }}
            >
              <HiOutlineChatAlt2 size={26} />
              <p className="text-xs">No conversations yet</p>
            </div>
          ) : (
            /* Date-grouped conversation rows */
            Object.entries(grouped).map(([label, convs]) => (
              <div key={label} className="mb-2">
                {/* Date group label (e.g. "Today", "Yesterday") */}
                <div
                  className="text-[0.6rem] font-bold uppercase tracking-[0.1em] px-2 py-1"
                  style={{ color: 'var(--sb-txt3)' }}
                >
                  {label}
                </div>

                {/* Individual conversation rows */}
                {convs.map((conv) => {
                  const isActive = conv.id === activeId;
                  const isEditing = editingId === conv.id;

                  return (
                    <div
                      key={conv.id}
                      id={`sidebar-item-${conv.id}`}
                      className={`group flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer transition-all duration-150 ${isEditing ? 'cursor-default' : ''}`}
                      style={{
                        /* Active row gets a gold-tinted background + border */
                        background: isActive ? 'var(--sb-active)' : 'transparent',
                        border: `1px solid ${isActive ? 'var(--sb-active-brd)' : 'transparent'}`,
                      }}
                      onMouseEnter={e => { if (!isActive && !isEditing) e.currentTarget.style.background = 'var(--sb-hover)'; }}
                      onMouseLeave={e => { if (!isActive && !isEditing) e.currentTarget.style.background = 'transparent'; }}
                      onClick={() => handleSelect(conv.id)}
                    >
                      {/* Chat icon — gold when active */}
                      <HiOutlineChatAlt2
                        size={13}
                        style={{ color: isActive ? 'var(--ci-primary-solid)' : 'var(--sb-txt3)', flexShrink: 0 }}
                      />

                      {/* Conversation title or Edit input */}
                      {isEditing ? (
                        <div className="flex-1 flex items-center gap-1 min-w-0" onClick={e => e.stopPropagation()}>
                          <input
                            autoFocus
                            className="flex-1 bg-transparent text-[0.775rem] outline-none border-none p-0 m-0"
                            style={{ color: 'var(--sb-txt)' }}
                            value={editTitle}
                            onChange={e => setEditTitle(e.target.value)}
                            onKeyDown={handleRenameKeyDown}
                            onBlur={handleRenameSubmit}
                          />
                          <button
                            className="flex-shrink-0 w-5 h-5 rounded-md flex items-center justify-center transition-all duration-150"
                            style={{
                              color: '#10b981',
                              background: 'rgba(16,185,129,0.12)',
                              border: '1px solid rgba(16,185,129,0.35)',
                            }}
                            onMouseEnter={e => {
                              e.currentTarget.style.background = '#10b981';
                              e.currentTarget.style.color = '#ffffff';
                              e.currentTarget.style.borderColor = '#10b981';
                            }}
                            onMouseLeave={e => {
                              e.currentTarget.style.background = 'rgba(16,185,129,0.12)';
                              e.currentTarget.style.color = '#10b981';
                              e.currentTarget.style.borderColor = 'rgba(16,185,129,0.35)';
                            }}
                            onClick={handleRenameSubmit}
                            aria-label="Confirm rename"
                          >
                            <HiCheck size={12} />
                          </button>
                        </div>
                      ) : (
                        <span
                          className="flex-1 text-[0.775rem] whitespace-nowrap overflow-hidden text-ellipsis"
                          style={{ color: isActive ? 'var(--sb-txt)' : 'var(--sb-txt2)' }}
                        >
                          {conv.title}
                        </span>
                      )}

                      {/* Actions revealed on row hover */}
                      {!isEditing && (
                        <div className="flex items-center gap-0.5 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition-all duration-150">
                          {/* Rename button */}
                          <button
                            className="flex-shrink-0 w-5 h-5 rounded flex items-center justify-center transition-all duration-150"
                            style={{ color: 'var(--ci-primary-solid)', opacity: 0.65 }}
                            onMouseEnter={e => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.background = 'color-mix(in srgb, var(--ci-primary-solid) 12%, transparent)'; }}
                            onMouseLeave={e => { e.currentTarget.style.opacity = '0.65'; e.currentTarget.style.background = 'transparent'; }}
                            onClick={(e) => handleRenameStart(e, conv.id, conv.title)}
                            aria-label="Rename conversation"
                          >
                            <HiOutlinePencil size={11} />
                          </button>

                          {/* Delete button */}
                          <button
                            className="flex-shrink-0 w-5 h-5 rounded flex items-center justify-center transition-all duration-150"
                            style={{ color: 'var(--ci-error-solid)', opacity: 0.65 }}
                            onMouseEnter={e => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.background = 'color-mix(in srgb, var(--ci-error-solid) 16%, transparent)'; }}
                            onMouseLeave={e => { e.currentTarget.style.opacity = '0.65'; e.currentTarget.style.background = 'transparent'; }}
                            onClick={(e) => { e.stopPropagation(); setDeleteTarget(conv.id); }}
                            aria-label="Delete conversation"
                          >
                            <HiOutlineTrash size={12} />
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>

        {/* ── Footer: user avatar + name + settings icon ── */}
        <div
          className="flex items-center gap-2.5 px-3 py-3 flex-shrink-0"
          style={{ borderTop: '1px solid var(--sb-brd)' }}
        >
          {/* User avatar */}
          <UserAvatar
            className="w-8 h-8 flex-shrink-0 rounded-full flex items-center justify-center font-semibold text-[0.75rem] overflow-hidden shadow-[0_4px_10px_rgba(29,108,184,0.3)] ring-2 ring-[var(--surf)]"
            style={{ background: 'linear-gradient(135deg, #1D6CB8 0%, #4DBADF 100%)', color: '#fff' }}
          />

          {/* User name + username */}
          <div className="flex-1 overflow-hidden">
            <div
              className="text-[0.775rem] font-semibold whitespace-nowrap overflow-hidden text-ellipsis leading-tight"
              style={{ color: 'var(--sb-txt)' }}
            >
              {user?.name || 'User'}
            </div>
            <div
              className="text-[0.65rem] whitespace-nowrap overflow-hidden text-ellipsis"
              style={{ color: 'var(--sb-txt3)', opacity: 0.8 }}
            >
              @{user?.username || 'user'}
            </div>
          </div>

          {/* Settings gear icon */}
          <button
            className="w-7 h-7 flex-shrink-0 rounded-lg flex items-center justify-center transition-all duration-150"
            style={{ color: 'var(--sb-txt2)' }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--sb-hover)'; e.currentTarget.style.color = 'var(--sb-txt)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--sb-txt2)'; }}
            onClick={() => setSettingsOpen(true)}
            aria-label="Open settings"
          >
            <HiOutlineCog size={16} />
          </button>
        </div>
      </aside>

      {/*
        Settings modal.
        Rendered as a separate centered overlay (z-200) above the sidebar.
        Uses the same --sb-* tokens so it matches the sidebar's theme.
      */}
      {settingsOpen && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[200] flex justify-center items-center p-4 animate-fade-in"
          onClick={() => setSettingsOpen(false)}
        >
          <div
            className="w-full max-w-sm max-h-[88dvh] flex flex-col rounded-2xl overflow-hidden animate-fade-in-scale"
            style={{
              background: 'var(--sb-bg)',
              border: '1px solid var(--sb-brd)',
              boxShadow: '0 24px 64px rgba(0,0,0,0.50)',
              color: 'var(--sb-txt)',
              /* Glassmorphism for the settings panel */
              backdropFilter: 'blur(20px)',
              WebkitBackdropFilter: 'blur(20px)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Settings header row */}
            <div
              className="flex items-center justify-between px-5 py-4 flex-shrink-0"
              style={{ borderBottom: '1px solid var(--sb-brd)' }}
            >
              <span className="text-[0.9375rem] font-semibold" style={{ color: 'var(--sb-txt)' }}>
                Settings
              </span>
              <button
                className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors duration-150"
                style={{ color: 'var(--sb-txt2)' }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--sb-hover)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                onClick={() => setSettingsOpen(false)}
              >
                <HiOutlineX size={16} />
              </button>
            </div>

            {/* Settings sections */}
            <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-5">



              {/* Audio section */}
              <section className="flex flex-col gap-2">
                <h3
                  className="text-[0.6rem] font-bold uppercase tracking-[0.1em]"
                  style={{ color: 'var(--sb-txt3)' }}
                >
                  Audio
                </h3>
                <div className="flex items-center justify-between text-sm gap-4">
                  <span style={{ color: 'var(--sb-txt)' }}>Microphone</span>
                  <CustomDropdown
                    options={[{ label: 'System Default', value: 'default' }]}
                    value={micInput}
                    onChange={setMicInput}
                  />
                </div>
              </section>

              {/* Data section */}
              <section className="flex flex-col gap-2">
                <h3
                  className="text-[0.6rem] font-bold uppercase tracking-[0.1em]"
                  style={{ color: 'var(--sb-txt3)' }}
                >
                  Data
                </h3>
                {/* Destructive action — clears all conversation history */}
                <button
                  className="w-full py-2 px-3 rounded-lg text-sm font-medium transition-all duration-150"
                  style={{
                    color: 'var(--ci-error-solid)',
                    background: 'color-mix(in srgb, var(--ci-error-solid) 10%, transparent)',
                    border: '1px solid transparent',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'color-mix(in srgb, var(--ci-error-solid) 88%, black)'; e.currentTarget.style.color = '#ffffff'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'color-mix(in srgb, var(--ci-error-solid) 10%, transparent)'; e.currentTarget.style.color = 'var(--ci-error-solid)'; }}
                  onClick={() => setClearModal(true)}
                >
                  Clear all conversations
                </button>

                {/* Admin-only: clear server DB result cache */}
                {isAdmin && (
                  <button
                    className="w-full py-2 px-3 rounded-lg text-sm font-medium transition-all duration-150 flex items-center justify-center gap-2"
                    disabled={clearingCache}
                    style={{
                      color: '#f59e0b',
                      background: 'color-mix(in srgb, #f59e0b 10%, transparent)',
                      border: '1px solid transparent',
                      opacity: clearingCache ? 0.6 : 1,
                      cursor: clearingCache ? 'not-allowed' : 'pointer',
                    }}
                    onMouseEnter={e => { if (!clearingCache) { e.currentTarget.style.background = 'color-mix(in srgb, #f59e0b 20%, transparent)'; e.currentTarget.style.borderColor = 'color-mix(in srgb, #f59e0b 35%, transparent)'; }}}
                    onMouseLeave={e => { e.currentTarget.style.background = 'color-mix(in srgb, #f59e0b 10%, transparent)'; e.currentTarget.style.borderColor = 'transparent'; }}
                    onClick={handleClearCache}
                  >
                    <HiOutlineRefresh size={15} className={clearingCache ? 'animate-spin' : ''} />
                    {clearingCache ? 'Clearing…' : 'Clear analytics cache'}
                  </button>
                )}

                <button
                  className="w-full py-2 px-3 rounded-lg text-sm font-medium transition-all duration-150 flex items-center gap-2"
                  style={{
                    color: 'var(--ci-primary-solid)',
                    background: 'color-mix(in srgb, var(--ci-primary-solid) 10%, transparent)',
                    border: '1px solid transparent',
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.background = 'color-mix(in srgb, var(--ci-primary-solid) 16%, transparent)';
                    e.currentTarget.style.borderColor = 'color-mix(in srgb, var(--ci-primary-solid) 28%, transparent)';
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.background = 'color-mix(in srgb, var(--ci-primary-solid) 10%, transparent)';
                    e.currentTarget.style.borderColor = 'transparent';
                  }}
                  onClick={() => {
                    setSettingsOpen(false);
                    setDocsOpen(true);
                  }}
                >
                  <HiOutlineDocumentAdd size={16} />
                  Manage knowledge documents
                </button>

                {/* Manage medicines — commented out
                <button
                  className="w-full py-2 px-3 rounded-lg text-sm font-medium transition-all duration-150 flex items-center gap-2"
                  style={{
                    color: 'var(--ci-primary-solid)',
                    background: 'color-mix(in srgb, var(--ci-primary-solid) 10%, transparent)',
                    border: '1px solid transparent',
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.background = 'color-mix(in srgb, var(--ci-primary-solid) 16%, transparent)';
                    e.currentTarget.style.borderColor = 'color-mix(in srgb, var(--ci-primary-solid) 28%, transparent)';
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.background = 'color-mix(in srgb, var(--ci-primary-solid) 10%, transparent)';
                    e.currentTarget.style.borderColor = 'transparent';
                  }}
                  onClick={() => {
                    setSettingsOpen(false);
                    setMedicineOpen(true);
                  }}
                >
                  <span className="text-base">💊</span>
                  Manage medicines
                </button>
                */}
              </section>

              {/* Account section */}
              <section className="flex flex-col gap-2">
                <h3
                  className="text-[0.6rem] font-bold uppercase tracking-[0.1em]"
                  style={{ color: 'var(--sb-txt3)' }}
                >
                  Account
                </h3>
                <button
                  className="w-full py-2 px-3 rounded-lg text-sm font-semibold transition-all duration-150 flex items-center justify-center gap-2"
                  style={{
                    color: 'var(--ci-error-solid)',
                    background: 'transparent',
                    border: '1px solid color-mix(in srgb, var(--ci-error-solid) 35%, transparent)',
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.background = 'var(--ci-error-solid)';
                    e.currentTarget.style.color = '#ffffff';
                    e.currentTarget.style.borderColor = 'var(--ci-error-solid)';
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.background = 'transparent';
                    e.currentTarget.style.color = 'var(--ci-error-solid)';
                    e.currentTarget.style.borderColor = 'color-mix(in srgb, var(--ci-error-solid) 35%, transparent)';
                  }}
                  onClick={() => {
                    logout();
                    toast.success('Logged out successfully');
                  }}
                >
                  <HiOutlineLogout size={16} />
                  Log out
                </button>
              </section>
            </div>
          </div>
        </div>
      )}

      {/* ── Confirmation modals ── */}

      {/* Single conversation delete confirm */}
      <ConfirmModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        title="Delete Conversation"
        message="Are you sure you want to delete this conversation? This cannot be undone."
      />

      {/* Clear all conversations confirm */}
      <ConfirmModal
        isOpen={clearModal}
        onClose={() => setClearModal(false)}
        onConfirm={confirmClear}
        title="Clear All Conversations"
        message="Delete all conversations? This cannot be undone."
      />

      <DocumentUpload isOpen={docsOpen} onClose={() => setDocsOpen(false)} />

      {/* Medicine Manager Modal — commented out
      {medicineOpen && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[200] flex justify-center items-center p-4 animate-fade-in overflow-y-auto"
          onClick={() => setMedicineOpen(false)}
        >
          <div
            className="w-full max-w-[500px] my-8 rounded-2xl overflow-hidden animate-fade-in-scale"
            style={{
              background: 'var(--sb-bg)',
              border: '1px solid var(--sb-brd)',
              boxShadow: '0 24px 64px rgba(0,0,0,0.50)',
              backdropFilter: 'blur(20px)',
              WebkitBackdropFilter: 'blur(20px)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="flex items-center justify-between px-5 py-4 flex-shrink-0"
              style={{ borderBottom: '1px solid var(--sb-brd)' }}
            >
              <span className="text-[0.9375rem] font-semibold" style={{ color: 'var(--sb-txt)' }}>
                💊 Medicine Manager
              </span>
              <button
                className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors duration-150"
                style={{ color: 'var(--sb-txt2)' }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--sb-hover)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                onClick={() => setMedicineOpen(false)}
              >
                <HiOutlineX size={16} />
              </button>
            </div>
            <div className="p-5 overflow-y-auto max-h-[calc(90vh-120px)]">
              <MedicineManager onClose={() => setMedicineOpen(false)} />
            </div>
          </div>
        </div>
      )}
      */}
    </>
  );
}
