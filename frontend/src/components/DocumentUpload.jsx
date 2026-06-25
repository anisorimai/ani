import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  HiOutlineDocumentAdd, HiOutlineDocument, HiOutlineCloudUpload,
  HiOutlineTrash, HiOutlineX,
} from 'react-icons/hi';
import toast from 'react-hot-toast';

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
  indexed: { label: 'Indexed', color: '#22c55e', bg: 'rgba(34,197,94,0.12)' },
  pending: { label: 'Indexing…', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
  failed: { label: 'Failed', color: '#ef4444', bg: 'rgba(239,68,68,0.12)' },
  missing: { label: 'Missing', color: '#6b7280', bg: 'rgba(107,114,128,0.12)' },
  unknown: { label: 'Pending', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
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

function inferDocType(filename) {
  const lowerName = (filename || '').toLowerCase();
  if (lowerName.includes('manual')) return 'manual';
  if (lowerName.includes('datasheet')) return 'datasheet';
  if (lowerName.includes('brochure')) return 'brochure';
  return 'manual';
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
  return documents.map((doc) => {
    const scopeLabel = (doc.dashboard_scope || doc.scope || 'enterprise').toLowerCase();
    const displayScope = scopeLabel === 'enterprise' || scopeLabel === 'general' ? 'General' : (scopeLabel.charAt(0).toUpperCase() + scopeLabel.slice(1));
    const displayEquipment = doc.equipment && doc.equipment !== 'General' ? doc.equipment : 'General';
    const href = doc.url || doc.source_url;
    return (
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
          {href ? (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                fontSize: '0.8rem', fontWeight: 500, color: 'var(--ci-primary-solid)',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                display: 'block', textDecoration: 'none',
              }}
            >
              {doc.filename}
            </a>
          ) : (
            <div
              style={{
                fontSize: '0.8rem', fontWeight: 500, color: 'var(--sb-txt)',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}
            >
              {doc.filename}
            </div>
          )}
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
          <div style={{ fontSize: '0.65rem', color: 'var(--sb-txt3)', marginTop: 2 }}>
            {displayEquipment} • {displayScope}
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
    );
  });
}

export default function DocumentUpload({ isOpen, onClose }) {
  const [documents, setDocuments] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [scope, setScope] = useState('');
  const [equipment, setEquipment] = useState('');
  const [docType, setDocType] = useState('');
  const [selectedFileName, setSelectedFileName] = useState('');

  const fileInputRef = useRef(null);
  const pollRef = useRef(null);

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

  const handleUpload = async (file) => {
    if (!file) return;
    const ext = '.' + (file.name.split('.').pop() || '').toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      toast.error(`Unsupported file format "${ext}". Supported: PDF, Word, images (PNG/JPG/WebP…), CSV, JSON, text.`);
      return;
    }
    if (!scope) {
      toast.error('Please select a repository before uploading.');
      return;
    }
    if ((scope === 'quality' || scope === 'manufacturing') && !equipment.trim()) {
      toast.error('Please enter an equipment name for this repository.');
      return;
    }
    if (!docType) {
      toast.error('Please choose a document type.');
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('scope', scope);
      if (scope !== 'general') formData.append('equipment', equipment.trim());
      formData.append('document_type', docType);
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
      setScope('');
      setEquipment('');
      setDocType('');
      setSelectedFileName('');
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

  useEffect(() => {
    if (!isOpen) {
      clearInterval(pollRef.current);
      pollRef.current = null;
      return;
    }

    setLoading(true);
    fetchDocuments().then((docs) => {
      setLoading(false);
      if (docs.some((d) => !d.index_status || d.index_status === 'pending' || d.index_status === 'unknown')) {
        startPolling();
      }
    });

    return () => {
      clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [isOpen, fetchDocuments, startPolling]);

  if (!isOpen) return null;

  const hasPending = documents.some(
    (d) => d.index_status === 'pending' || d.index_status === 'unknown' || !d.index_status
  );
  const isUploadDisabled = !scope || ((scope === 'quality' || scope === 'manufacturing') && !equipment.trim()) || !docType;
  const previewLine = selectedFileName && scope && docType && ((scope === 'general') || equipment.trim())
    ? `${scope === 'general' ? 'general' : scope} / ${scope === 'general' ? 'General' : (equipment.trim() || 'Equipment')} / ${selectedFileName} [${docType}]`
    : null;

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
          width: '100%', maxWidth: 480, maxHeight: '85vh',
          display: 'flex', flexDirection: 'column',
          background: 'var(--sb-bg)', border: '1px solid var(--sb-brd)',
          borderRadius: 16, overflow: 'hidden',
          boxShadow: '0 24px 64px rgba(0,0,0,0.5)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '16px 20px', borderBottom: '1px solid var(--sb-brd)', flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--sb-txt)' }}>
            <HiOutlineDocumentAdd size={18} style={{ color: 'var(--ci-primary-solid)' }} />
            <span style={{ fontSize: '0.9375rem', fontWeight: 600 }}>Knowledge Documents</span>
            {hasPending && (
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

        <div style={{ margin: '16px 20px 0', display: 'grid', gap: 8 }}>
          <label style={{ fontSize: '0.75rem', color: 'var(--sb-txt2)', fontWeight: 600 }}>
            Repository
          </label>
          <select
            value={scope}
            onChange={(e) => {
              const nextScope = e.target.value;
              setScope(nextScope);
              if (nextScope === 'general') setEquipment('');
            }}
            style={{
              width: '100%', padding: '8px 10px', borderRadius: 8,
              background: 'var(--sb-hover)', border: '1px solid var(--sb-brd)',
              color: 'var(--sb-txt)', fontSize: '0.8rem',
            }}
          >
            <option value="">Select repository</option>
            <option value="quality">Quality</option>
            <option value="manufacturing">Manufacturing</option>
            <option value="general">General</option>
          </select>

          {(scope === 'quality' || scope === 'manufacturing') && (
            <>
              <label style={{ fontSize: '0.75rem', color: 'var(--sb-txt2)', fontWeight: 600 }}>
                Equipment
              </label>
              <input
                value={equipment}
                onChange={(e) => setEquipment(e.target.value)}
                placeholder="e.g. HPLC, pH Meter, Reactor 1"
                style={{
                  width: '100%', padding: '8px 10px', borderRadius: 8,
                  background: 'var(--sb-hover)', border: '1px solid var(--sb-brd)',
                  color: 'var(--sb-txt)', fontSize: '0.8rem',
                }}
              />
            </>
          )}

          <label style={{ fontSize: '0.75rem', color: 'var(--sb-txt2)', fontWeight: 600 }}>
            Document Type
          </label>
          <select
            value={docType}
            onChange={(e) => setDocType(e.target.value)}
            style={{
              width: '100%', padding: '8px 10px', borderRadius: 8,
              background: 'var(--sb-hover)', border: '1px solid var(--sb-brd)',
              color: 'var(--sb-txt)', fontSize: '0.8rem',
            }}
          >
            <option value="">Select document type</option>
            <option value="manual">Manual</option>
            <option value="datasheet">Datasheet</option>
            <option value="brochure">Product Brochure</option>
          </select>

          {previewLine && (
            <div style={{ fontSize: '0.72rem', color: 'var(--sb-txt2)', paddingTop: 2 }}>
              {previewLine}
            </div>
          )}
        </div>

        <div
          style={{
            margin: '16px 20px 0',
            border: `2px dashed ${dragOver ? 'var(--ci-primary-solid)' : 'var(--sb-brd)'}`,
            borderRadius: 12, padding: '20px 16px',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
            background: dragOver ? 'var(--sb-hover)' : 'var(--sb-bg)',
            cursor: uploading || isUploadDisabled ? 'default' : 'pointer',
            transition: 'all 0.15s',
            opacity: uploading || isUploadDisabled ? 0.65 : 1,
            flexShrink: 0,
          }}
          onDragOver={(e) => { e.preventDefault(); if (!uploading && !isUploadDisabled) setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const file = e.dataTransfer.files?.[0];
            if (file) handleUpload(file);
          }}
          onClick={() => {
            if (uploading || isUploadDisabled) return;
            fileInputRef.current?.click();
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) {
                setSelectedFileName(f.name);
                setDocType((prev) => prev || inferDocType(f.name));
                handleUpload(f);
              }
              e.target.value = '';
            }}
            style={{ display: 'none' }}
          />

          <HiOutlineCloudUpload
            size={28}
            style={{ color: 'var(--ci-primary-solid)', opacity: uploading ? 0.6 : 1 }}
          />
          {uploading ? (
            <p style={{ fontSize: '0.8125rem', color: 'var(--sb-txt2)', margin: 0 }}>
              Uploading and queuing for indexing…
            </p>
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

        <div
          style={{
            flex: 1, overflowY: 'auto', padding: '12px 20px 16px',
            display: 'flex', flexDirection: 'column', gap: 6,
          }}
        >
          <DocList
            documents={documents}
            loading={loading}
            deleting={deleting}
            onDelete={handleDelete}
            emptyLabel="No documents uploaded yet"
            emptyHint="Upload a file above to add it to the knowledge base"
          />
        </div>

        <div
          style={{
            padding: '10px 20px 14px', borderTop: '1px solid var(--sb-brd)',
            flexShrink: 0,
          }}
        >
          <p style={{ fontSize: '0.7rem', color: 'var(--sb-txt3)', margin: 0, lineHeight: 1.5 }}>
            Uploaded documents are chunked, embedded, and stored in the shared enterprise knowledge base. Once indexed, their content is automatically retrieved when relevant to your questions.
          </p>
        </div>
      </div>
    </div>
  );
}
