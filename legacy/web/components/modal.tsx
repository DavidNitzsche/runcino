'use client';

import { useEffect, useCallback } from 'react';

interface ModalProps {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  width?: number;
}

export function Modal({ title, onClose, children, width = 520 }: ModalProps) {
  const handleKey = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  }, [onClose]);

  useEffect(() => {
    document.addEventListener('keydown', handleKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.body.style.overflow = '';
    };
  }, [handleKey]);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.72)',
        backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: width,
          maxHeight: 'calc(100vh - 48px)',
          overflowY: 'auto',
          background: 'var(--color-l1)',
          border: '1px solid var(--color-l3)',
          borderRadius: 16,
          boxShadow: '0 32px 80px rgba(0,0,0,0.6)',
          animation: 'modal-in 0.18s ease',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '20px 24px 0',
        }}>
          <div style={{
            fontFamily: 'var(--font-data)', fontSize: 11, fontWeight: 700,
            letterSpacing: '1.8px', textTransform: 'uppercase', color: 'var(--color-mute)',
          }}>
            {title}
          </div>
          <button
            onClick={onClose}
            style={{
              width: 28, height: 28, borderRadius: 8,
              border: '1px solid var(--color-l4)',
              background: 'transparent', color: 'var(--color-t3)',
              fontSize: 14, cursor: 'pointer', display: 'grid', placeItems: 'center',
              fontFamily: 'inherit', lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '20px 24px 24px' }}>
          {children}
        </div>
      </div>

      <style>{`
        @keyframes modal-in {
          from { opacity: 0; transform: translateY(12px) scale(0.98); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </div>
  );
}
