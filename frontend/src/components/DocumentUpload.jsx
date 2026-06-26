import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  HiOutlineDocumentAdd, HiOutlineDocument, HiOutlineCloudUpload,
  HiOutlineTrash, HiOutlineX, HiOutlineCheckCircle,
  HiOutlineClock, HiOutlineRefresh, HiOutlineOfficeBuilding,
  HiOutlineUser,
} from 'react-icons/hi';
import toast from 'react-hot-toast';
import useAuthStore from '../store/useAuthStore';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000/api';

function getAuthToken() {
  try {
    const authData = JSON.parse(localStorage.getItem('auth-storage') || '{}');
    return authData?.state?.token || null;
  } catch {
    return null;
  }
}

function authHeaders() {
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

const ALLOWED_EXTENSIONS = new Set([
  '.txt', '.md', '.pdf', '.csv', '.json', '.doc', '.docx',
  '.xls', '.xlsx', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp',
]);

const STATUS_CONFIG = {
  indexed:  { label: 'Indexed',    color: '#22c55e', bg: 'rgba(34,197,94,0.12)'  },
  pending:  { label: 'Indexing…',  color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
  failed:   { label: 'Failed',     color: '#ef4444', bg: 'rgba(239,68,68,0.12)'  },
  missing:  { label: 'Missing',    color: 'var(--txt2)', bg: 'var(--brd2)' },
  unknown:  { label: 'Pending',    color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
};

function StatusBadge({ status }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.unknown;
  return (
    <span
      style={{
        fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.05em',
        padding: '2px 6px', borderRadius: 4,
        color: cfg.color, background: cfg.bg,
        textTransform: 'uppercase', flexShrink: 0,
      }}
    >
      {cfg.label}
    </span>
  );
}

function formatSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function DocList({ documents, loading, deleting, onDelete, emptyLabel, emptyHint }) {
  if (loading) {
    return (
      <p style={{ color: 'var(--sb-txt3)', fontSize: '0.8rem', textAlign: 'center', margin: 'auto' }}>
        Loading documents…
      </p>
    );
  }
  if (documents.length === 0) {
    return (
      <div style={{ textAlign: 'center', margin: 'auto', color: 'var(--sb-txt3)' }}>
        <HiOutlineDocument size={32} style={{ opacity: 0.4, marginBottom: 8 }} />
        <p style={{ fontSize: '0.8rem', margin: 0 }}>{emptyLabel}</p>
        <p style={{ fontSize: '0.72rem', margin: '4px 0 0', opacity: 0.7 }}>{emptyHint}</p>
      </div>
    );
  }
  return documents.map((doc) => (
    <div
      key={doc.filename}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 12px', borderRadius: 10,
        background: 'var(--sb-hover)', border: '1px solid var(--sb-brd)',
      }}
    >
      <HiOutlineDocument size={16} style={{ color: 'var(--ci-primary-solid)', flexShrink: 0 }} />

      <div style={{ flex: 1, overflow: 'hidden' }}>
        <div
          style={{
            fontSize: '0.8rem', fontWeight: 500, color: 'var(--sb-txt)',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}
        >
          {doc.filename}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 2 }}>
          {doc.size && (
            <span style={{ fontSize: '0.65rem', color: 'var(--sb-txt3)' }}>
              {formatSize(doc.size)}
            </span>
          )}
          {doc.chunk_count != null && (
            <span style={{ fontSize: '0.65rem', color: 'var(--sb-txt3)' }}>
              {doc.chunk_count} chunks
            </span>
          )}
        </div>
        {doc.index_status === 'failed' && doc.error_message && (
          <div
            style={{
              fontSize: '0.62rem', color: '#ef4444', marginTop: 3,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}
            title={doc.error_message}
          >
            {doc.error_message}
          </div>
        )}
      </div>

      <StatusBadge status={doc.index_status || 'unknown'} />

      {onDelete && (
        <button
          disabled={deleting === doc.filename}
          style={{
            width: 26, height: 26, display: 'flex', alignItems: 'center',
            justifyContent: 'center', borderRadius: 6, border: 'none',
            background: 'transparent', color: 'var(--sb-txt3)',
            cursor: deleting === doc.filename ? 'default' : 'pointer',
            flexShrink: 0, opacity: deleting === doc.filename ? 0.4 : 1,
          }}
          onMouseEnter={e => {
            e.currentTarget.style.color = '#ef4444';
            e.currentTarget.style.background = 'rgba(239,68,68,0.12)';
          }}
          onMouseLeave={e => {
            e.currentTarget.style.color = 'var(--sb-txt3)';
            e.currentTarget.style.background = 'transparent';
          }}
          onClick={() => onDelete(doc.filename)}
          title="Remove document"
        >
          <HiOutlineTrash size={13} />
        </button>
      )}
    </div>
  ));
}

const SCOPE_OPTIONS = [
  { value: '',           label: 'General' },
  { value: 'quality',    label: 'Quality' },
  { value: 'production', label: 'Production' },
  { value: 'packaging',  label: 'Packaging' },
  { value: 'logistics',  label: 'Logistics' },
];

const DOC_TYPE_OPTIONS = [
  '', 'Brochure', 'Catalog', 'Certificate', 'Datasheet', 'Drawing',
  'Form', 'Manual', 'Policy', 'Protocol', 'Report', 'SOP', 'Specification', 'Other',
];

const fieldStyle = {
  width: '100%', padding: '7px 10px', borderRadius: 8, fontSize: '0.8125rem',
  color: 'var(--sb-txt)', background: 'var(--sb-hover)',
  border: '1px solid var(--sb-brd)', outline: 'none', boxSizing: 'border-box',
};

function MetaFields({ scope, equipment, docType, docTypeOther, onScope, onEquipment, onDocType, onDocTypeOther }) {
  return (
    <div
      style={{
        margin: '12px 20px 0', padding: '14px 16px',
        borderRadius: 12, border: '1px solid var(--sb-brd)',
        background: 'var(--sb-hover)', display: 'flex', flexDirection: 'column', gap: 10,
        flexShrink: 0,
      }}
    >
      <p style={{ margin: 0, fontSize: '0.72rem', fontWeight: 600, color: 'var(--sb-txt2)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
        Document metadata
      </p>

      {/* Scope */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--sb-txt)' }}>
          Scope <span style={{ color: '#ef4444' }}>*</span>
        </label>
        <select
          value={scope}
          onChange={(e) => onScope(e.target.value)}
          style={{ ...fieldStyle, appearance: 'none', WebkitAppearance: 'none', cursor: 'pointer' }}
        >
          {SCOPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {/* Equipment */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--sb-txt)' }}>
            Equipment <span style={{ color: '#ef4444' }}>*</span>
          </label>
          <input
            type="text"
            value={equipment}
            onChange={(e) => onEquipment(e.target.value)}
            placeholder="e.g. Flame Photometer"
            style={fieldStyle}
          />
        </div>

        {/* Document type */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--sb-txt)' }}>
            Document Type <span style={{ color: '#ef4444' }}>*</span>
          </label>
          <select
            value={docType}
            onChange={(e) => onDocType(e.target.value)}
            style={{ ...fieldStyle, appearance: 'none', WebkitAppearance: 'none', cursor: 'pointer' }}
          >
            {DOC_TYPE_OPTIONS.map((o) => (
              <option key={o} value={o}>{o || '— Select type —'}</option>
            ))}
          </select>
          {docType === 'Other' && (
            <input
              type="text"
              value={docTypeOther}
              onChange={(e) => onDocTypeOther(e.target.value)}
              placeholder="Specify document type"
              style={fieldStyle}
              autoFocus
            />
          )}
        </div>
      </div>
    </div>
  );
}

export default function DocumentUpload({ isOpen, onClose }) {
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.is_admin === true;

  const [tab, setTab] = useState('personal');

  // Personal docs state
  const [documents, setDocuments] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [pendingFile, setPendingFile] = useState(null);

  // Metadata fields — personal
  const [scope,     setScope]     = useState('');
  const [equipment, setEquipment] = useState('');
  const [docType,      setDocType]      = useState('');
  const [docTypeOther, setDocTypeOther] = useState('');

  // Org docs state (admin only)
  const [orgDocs, setOrgDocs] = useState([]);
  const [orgUploading, setOrgUploading] = useState(false);
  const [orgLoading, setOrgLoading] = useState(false);
  const [orgDeleting, setOrgDeleting] = useState(null);
  const [orgDragOver, setOrgDragOver] = useState(false);
  const [orgPendingFile, setOrgPendingFile] = useState(null);

  // Metadata fields — org
  const [orgScope,        setOrgScope]        = useState('');
  const [orgEquipment,    setOrgEquipment]    = useState('');
  const [orgDocType,      setOrgDocType]      = useState('');
  const [orgDocTypeOther, setOrgDocTypeOther] = useState('');

  const fileInputRef = useRef(null);
  const orgFileInputRef = useRef(null);
  const pollRef = useRef(null);
  const orgPollRef = useRef(null);

  // ── Personal docs ─────────────────────────────────────────────────────────

  const fetchDocuments = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/documents/`, { headers: authHeaders() });
      if (res.ok) {
        const data = await res.json();
        const docs = Array.isArray(data) ? data : (data?.documents || []);
        setDocuments(docs);
        return docs;
      }
    } catch (err) {
      console.warn('Failed to fetch documents:', err);
    }
    return [];
  }, []);

  const startPolling = useCallback(() => {
    if (pollRef.current) return;
    pollRef.current = setInterval(async () => {
      const docs = await fetchDocuments();
      const stillPending = docs.some(
        (d) => d.index_status === 'pending' || d.index_status === 'unknown' || !d.index_status
      );
      if (!stillPending) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    }, 3000);
  }, [fetchDocuments]);

  const stageFile = (file) => {
    if (!file) return;
    const ext = '.' + (file.name.split('.').pop() || '').toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      toast.error(`Unsupported file format "${ext}". Supported: PDF, Word, images (PNG/JPG/WebP…), CSV, JSON, text.`);
      return;
    }
    setPendingFile(file);
  };

  const handleUpload = async () => {
    const file = pendingFile;
    if (!file) return;
    const effectiveDocType = docType === 'Other' ? docTypeOther.trim() : docType;
    if (!equipment.trim())  { toast.error('Equipment is required'); return; }
    if (!effectiveDocType)  { toast.error(docType === 'Other' ? 'Please specify the document type' : 'Document Type is required'); return; }
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      if (scope)             formData.append('scope',         scope);
      if (equipment)         formData.append('equipment',     equipment);
      if (effectiveDocType)  formData.append('document_type', effectiveDocType);
      const res = await fetch(`${API_BASE}/documents/upload`, {
        method: 'POST',
        headers: authHeaders(),
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Upload failed');
      }
      toast.success(`"${file.name}" uploaded — indexing in background`);
      setPendingFile(null);
      setScope(''); setEquipment(''); setDocType(''); setDocTypeOther('');
      await fetchDocuments();
      startPolling();
    } catch (err) {
      toast.error(err.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (filename) => {
    setDeleting(filename);
    try {
      const res = await fetch(
        `${API_BASE}/documents/${encodeURIComponent(filename)}`,
        { method: 'DELETE', headers: authHeaders() }
      );
      if (!res.ok) throw new Error('Delete failed');
      toast.success(`"${filename}" removed`);
      setDocuments((prev) => prev.filter((d) => d.filename !== filename));
    } catch (err) {
      toast.error(err.message || 'Delete failed');
    } finally {
      setDeleting(null);
    }
  };

  // ── Org docs (admin only) ─────────────────────────────────────────────────

  const fetchOrgDocuments = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/documents/org`, { headers: authHeaders() });
      if (res.ok) {
        const data = await res.json();
        const docs = Array.isArray(data) ? data : (data?.documents || []);
        setOrgDocs(docs);
        return docs;
      }
    } catch (err) {
      console.warn('Failed to fetch org documents:', err);
    }
    return [];
  }, []);

  const startOrgPolling = useCallback(() => {
    if (orgPollRef.current) return;
    orgPollRef.current = setInterval(async () => {
      const docs = await fetchOrgDocuments();
      const stillPending = docs.some(
        (d) => d.index_status === 'pending' || d.index_status === 'unknown' || !d.index_status
      );
      if (!stillPending) {
        clearInterval(orgPollRef.current);
        orgPollRef.current = null;
      }
    }, 3000);
  }, [fetchOrgDocuments]);

  const stageOrgFile = (file) => {
    if (!file) return;
    const ext = '.' + (file.name.split('.').pop() || '').toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      toast.error(`Unsupported file format "${ext}".`);
      return;
    }
    setOrgPendingFile(file);
  };

  const handleOrgUpload = async () => {
    const file = orgPendingFile;
    if (!file) return;
    const effectiveOrgDocType = orgDocType === 'Other' ? orgDocTypeOther.trim() : orgDocType;
    if (!orgEquipment.trim())   { toast.error('Equipment is required'); return; }
    if (!effectiveOrgDocType)   { toast.error(orgDocType === 'Other' ? 'Please specify the document type' : 'Document Type is required'); return; }
    setOrgUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      if (orgScope)            formData.append('scope',         orgScope);
      if (orgEquipment)        formData.append('equipment',     orgEquipment);
      if (effectiveOrgDocType) formData.append('document_type', effectiveOrgDocType);
      const res = await fetch(`${API_BASE}/documents/org/upload`, {
        method: 'POST',
        headers: authHeaders(),
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Upload failed');
      }
      toast.success(`"${file.name}" shared with your organisation — indexing in background`);
      setOrgPendingFile(null);
      setOrgScope(''); setOrgEquipment(''); setOrgDocType(''); setOrgDocTypeOther('');
      await fetchOrgDocuments();
      startOrgPolling();
    } catch (err) {
      toast.error(err.message || 'Upload failed');
    } finally {
      setOrgUploading(false);
    }
  };

  const handleOrgDelete = async (filename) => {
    setOrgDeleting(filename);
    try {
      const res = await fetch(
        `${API_BASE}/documents/org/${encodeURIComponent(filename)}`,
        { method: 'DELETE', headers: authHeaders() }
      );
      if (!res.ok) throw new Error('Delete failed');
      toast.success(`"${filename}" removed from organisation`);
      setOrgDocs((prev) => prev.filter((d) => d.filename !== filename));
    } catch (err) {
      toast.error(err.message || 'Delete failed');
    } finally {
      setOrgDeleting(null);
    }
  };

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!isOpen) {
      clearInterval(pollRef.current);    pollRef.current = null;
      clearInterval(orgPollRef.current); orgPollRef.current = null;
      setPendingFile(null);
      setOrgPendingFile(null);
      return;
    }

    setLoading(true);
    fetchDocuments().then((docs) => {
      setLoading(false);
      if (docs.some((d) => !d.index_status || d.index_status === 'pending' || d.index_status === 'unknown')) {
        startPolling();
      }
    });

    if (isAdmin) {
      setOrgLoading(true);
      fetchOrgDocuments().then((docs) => {
        setOrgLoading(false);
        if (docs.some((d) => !d.index_status || d.index_status === 'pending' || d.index_status === 'unknown')) {
          startOrgPolling();
        }
      });
    }

    return () => {
      clearInterval(pollRef.current);    pollRef.current = null;
      clearInterval(orgPollRef.current); orgPollRef.current = null;
    };
  }, [isOpen, isAdmin, fetchDocuments, fetchOrgDocuments, startPolling, startOrgPolling]);

  if (!isOpen) return null;

  const hasPending = documents.some(
    (d) => d.index_status === 'pending' || d.index_status === 'unknown' || !d.index_status
  );
  const hasOrgPending = orgDocs.some(
    (d) => d.index_status === 'pending' || d.index_status === 'unknown' || !d.index_status
  );

  const isOrgTab = isAdmin && tab === 'org';

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
        backdropFilter: 'blur(4px)', zIndex: 300,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: '100%', maxWidth: 480, maxHeight: '92dvh',
          display: 'flex', flexDirection: 'column',
          background: 'var(--sb-bg)', border: '1px solid var(--sb-brd)',
          borderRadius: 16, overflow: 'hidden',
          boxShadow: '0 24px 64px rgba(0,0,0,0.5)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '16px 20px', borderBottom: '1px solid var(--sb-brd)', flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--sb-txt)' }}>
            <HiOutlineDocumentAdd size={18} style={{ color: 'var(--ci-primary-solid)' }} />
            <span style={{ fontSize: '0.9375rem', fontWeight: 600 }}>Knowledge Documents</span>
            {(hasPending || hasOrgPending) && (
              <span style={{ fontSize: '0.65rem', color: '#f59e0b', fontWeight: 600 }}>
                • Indexing…
              </span>
            )}
          </div>
          <button
            style={{
              width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
              borderRadius: 8, border: 'none', background: 'transparent',
              color: 'var(--sb-txt2)', cursor: 'pointer',
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--sb-hover)'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            onClick={onClose}
          >
            <HiOutlineX size={16} />
          </button>
        </div>

        {/* ── Tab bar (admin only) ── */}
        {isAdmin && (
          <div
            style={{
              display: 'flex', borderBottom: '1px solid var(--sb-brd)',
              padding: '0 20px', flexShrink: 0, gap: 2,
            }}
          >
            {[
              { key: 'personal', icon: <HiOutlineUser size={13} />, label: 'My Documents' },
              { key: 'org',      icon: <HiOutlineOfficeBuilding size={13} />, label: 'Org Shared' },
            ].map(({ key, icon, label }) => {
              const active = tab === key;
              return (
                <button
                  key={key}
                  onClick={() => setTab(key)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 5,
                    padding: '10px 14px', border: 'none', background: 'transparent',
                    cursor: 'pointer', fontSize: '0.8125rem', fontWeight: active ? 600 : 400,
                    color: active ? 'var(--ci-primary-solid)' : 'var(--sb-txt2)',
                    borderBottom: active ? '2px solid var(--ci-primary-solid)' : '2px solid transparent',
                    marginBottom: -1, transition: 'color 0.15s',
                  }}
                >
                  {icon}
                  {label}
                  {key === 'org' && hasOrgPending && (
                    <span style={{ fontSize: '0.6rem', color: '#f59e0b', fontWeight: 700 }}>●</span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* ── Org tab info banner ── */}
        {isOrgTab && (
          <div
            style={{
              margin: '12px 20px 0',
              padding: '10px 14px',
              borderRadius: 10,
              background: 'color-mix(in srgb, var(--ci-primary-solid) 8%, transparent)',
              border: '1px solid color-mix(in srgb, var(--ci-primary-solid) 25%, transparent)',
              fontSize: '0.74rem',
              color: 'var(--sb-txt2)',
              lineHeight: 1.5,
              flexShrink: 0,
            }}
          >
            Documents uploaded here are shared with <strong style={{ color: 'var(--sb-txt)' }}>all members</strong> of your organisation. They are automatically included in every user's knowledge base.
          </div>
        )}

        {/* ── Drop zone ── */}
        <div
          style={{
            margin: '16px 20px 0',
            border: `2px dashed ${(isOrgTab ? orgDragOver : dragOver) ? 'var(--ci-primary-solid)' : 'var(--sb-brd)'}`,
            borderRadius: 12, padding: '20px 16px',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
            background: (isOrgTab ? orgDragOver : dragOver)
              ? 'color-mix(in srgb, var(--ci-primary-solid) 6%, transparent)'
              : 'var(--sb-hover)',
            cursor: (isOrgTab ? orgUploading : uploading) ? 'default' : 'pointer',
            transition: 'all 0.15s',
            opacity: (isOrgTab ? orgUploading : uploading) ? 0.7 : 1,
            flexShrink: 0,
          }}
          onDragOver={(e) => { e.preventDefault(); isOrgTab ? setOrgDragOver(true) : setDragOver(true); }}
          onDragLeave={() => isOrgTab ? setOrgDragOver(false) : setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            isOrgTab ? setOrgDragOver(false) : setDragOver(false);
            const file = e.dataTransfer.files?.[0];
            if (file) isOrgTab ? stageOrgFile(file) : stageFile(file);
          }}
          onClick={() => {
            if (isOrgTab ? orgUploading : uploading) return;
            isOrgTab ? orgFileInputRef.current?.click() : fileInputRef.current?.click();
          }}
        >
          <input ref={fileInputRef} type="file" onChange={(e) => { const f = e.target.files?.[0]; if (f) stageFile(f); e.target.value = ''; }} style={{ display: 'none' }} />
          <input ref={orgFileInputRef} type="file" onChange={(e) => { const f = e.target.files?.[0]; if (f) stageOrgFile(f); e.target.value = ''; }} style={{ display: 'none' }} />

          <HiOutlineCloudUpload
            size={28}
            style={{ color: 'var(--ci-primary-solid)', opacity: (isOrgTab ? orgUploading : uploading) ? 0.6 : 1 }}
          />
          {(isOrgTab ? orgUploading : uploading) ? (
            <p style={{ fontSize: '0.8125rem', color: 'var(--sb-txt2)', margin: 0 }}>
              Uploading and queuing for indexing…
            </p>
          ) : (isOrgTab ? orgPendingFile : pendingFile) ? (
            <>
              <p style={{ fontSize: '0.8125rem', color: 'var(--ci-primary-solid)', margin: 0, fontWeight: 600 }}>
                {(isOrgTab ? orgPendingFile : pendingFile).name}
              </p>
              <span style={{ fontSize: '0.7rem', color: 'var(--sb-txt3)' }}>
                {formatSize((isOrgTab ? orgPendingFile : pendingFile).size)} · Click to change file
              </span>
            </>
          ) : (
            <>
              <p style={{ fontSize: '0.8125rem', color: 'var(--sb-txt)', margin: 0, fontWeight: 500 }}>
                Drop a file or click to browse
              </p>
              <span style={{ fontSize: '0.7rem', color: 'var(--sb-txt3)' }}>
                PDF · Word · CSV · JSON · Text · PNG · JPG · WebP · and more
              </span>
            </>
          )}
        </div>

        {/* ── Metadata fields ── */}
        <MetaFields
          scope={isOrgTab ? orgScope : scope}
          equipment={isOrgTab ? orgEquipment : equipment}
          docType={isOrgTab ? orgDocType : docType}
          docTypeOther={isOrgTab ? orgDocTypeOther : docTypeOther}
          onScope={isOrgTab ? setOrgScope : setScope}
          onEquipment={isOrgTab ? setOrgEquipment : setEquipment}
          onDocType={isOrgTab ? setOrgDocType : setDocType}
          onDocTypeOther={isOrgTab ? setOrgDocTypeOther : setDocTypeOther}
        />

        {/* ── Upload button ── */}
        {(isOrgTab ? orgPendingFile : pendingFile) && (() => {
          const busy = isOrgTab ? orgUploading : uploading;
          const effectiveDT = isOrgTab
            ? (orgDocType === 'Other' ? orgDocTypeOther.trim() : orgDocType)
            : (docType === 'Other' ? docTypeOther.trim() : docType);
          const ready = isOrgTab
            ? (orgEquipment.trim() && effectiveDT)
            : (equipment.trim() && effectiveDT);
          return (
            <div style={{ margin: '10px 20px 0', flexShrink: 0 }}>
              <button
                disabled={busy || !ready}
                onClick={isOrgTab ? handleOrgUpload : handleUpload}
                style={{
                  width: '100%', padding: '9px 0', borderRadius: 10, border: 'none',
                  background: 'var(--ci-primary-solid)', color: '#fff',
                  fontSize: '0.875rem', fontWeight: 600,
                  cursor: (busy || !ready) ? 'not-allowed' : 'pointer',
                  opacity: (busy || !ready) ? 0.45 : 1,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                }}
              >
                <HiOutlineCloudUpload size={16} />
                {busy ? 'Uploading…' : 'Upload & Index'}
              </button>
            </div>
          );
        })()}

        {/* ── Document list ── */}
        <div
          style={{
            flex: 1, overflowY: 'auto', padding: '12px 20px 16px',
            display: 'flex', flexDirection: 'column', gap: 6,
          }}
        >
          {isOrgTab ? (
            <DocList
              documents={orgDocs}
              loading={orgLoading}
              deleting={orgDeleting}
              onDelete={handleOrgDelete}
              emptyLabel="No shared documents yet"
              emptyHint="Upload a file above to share it with your entire organisation"
            />
          ) : (
            <DocList
              documents={documents}
              loading={loading}
              deleting={deleting}
              onDelete={handleDelete}
              emptyLabel="No documents uploaded yet"
              emptyHint="Upload a file above to add it to the knowledge base"
            />
          )}
        </div>

        {/* ── Footer note ── */}
        <div
          style={{
            padding: '10px 20px 14px', borderTop: '1px solid var(--sb-brd)',
            flexShrink: 0,
          }}
        >
          <p style={{ fontSize: '0.7rem', color: 'var(--sb-txt3)', margin: 0, lineHeight: 1.5 }}>
            {isOrgTab
              ? 'Org documents are chunked, embedded, and made available to all users in your organisation.'
              : 'Uploaded documents are chunked, embedded, and stored in the RAG knowledge base. Once indexed, their content is automatically retrieved when relevant to your questions.'}
          </p>
        </div>
      </div>
    </div>
  );
}
