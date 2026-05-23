// SPDX-License-Identifier: Apache-2.0
'use client';

import type { CSSProperties, ReactNode } from 'react';
import { useEffect, useRef, useState, useId, isValidElement, cloneElement } from 'react';

// ─────────────────────────────────────────────────────────────
// ICON — Material Symbols Rounded (Google official)
// ─────────────────────────────────────────────────────────────
const ICON_MAP: Record<string, string> = {
  health: 'monitor_heart',
  pack: 'deployed_code',
  tool: 'build',
  usecase: 'schema',
  audit: 'fact_check',
  llm: 'smart_toy',
  admin: 'admin_panel_settings',
  user: 'person',
  log: 'list_alt',
  settings: 'settings',
  search: 'search',
  chev: 'chevron_right',
  chevDown: 'expand_more',
  external: 'open_in_new',
  play: 'play_arrow',
  refresh: 'refresh',
  upload: 'upload',
  download: 'download',
  plus: 'add',
  copy: 'content_copy',
  check: 'check',
  x: 'close',
  info: 'info',
  filter: 'filter_list',
  book: 'menu_book',
  drag: 'drag_indicator',
  folder: 'folder',
  spark: 'bolt',
  cpu: 'memory',
  menu: 'menu',
  notification: 'notifications',
  more: 'more_vert',
  warning: 'warning',
  error: 'error',
  success: 'check_circle',
  arrowBack: 'arrow_back',
  account: 'account_circle',
  apps: 'apps',
};

export interface IconProps {
  name: string;
  size?: number;
  fill?: boolean;
  weight?: number;
  className?: string;
  style?: CSSProperties;
}

export function Icon({
  name,
  size = 20,
  fill = false,
  weight = 400,
  className = '',
  style,
}: IconProps) {
  const mapped = ICON_MAP[name] ?? name;
  const opsz = Math.max(20, Math.min(48, size));
  return (
    <span
      aria-hidden="true"
      className={`material-symbols-rounded ico ${className}`.trim()}
      style={{
        fontSize: size,
        fontVariationSettings: `'FILL' ${fill ? 1 : 0}, 'wght' ${weight}, 'GRAD' 0, 'opsz' ${opsz}`,
        ...style,
      }}
    >
      {mapped}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────
// PILL / DOT / STATUS
// ─────────────────────────────────────────────────────────────
export function Pill({
  children,
  kind = '',
}: {
  children: ReactNode;
  kind?: '' | 'good' | 'warn' | 'bad' | 'accent' | 'info' | 'solid';
}) {
  return <span className={`pill ${kind}`.trim()}>{children}</span>;
}

export function SideEffectPill({ side }: { side: string }) {
  if (side === 'write') return <span className="pill warn">⚠ write</span>;
  if (side === 'read') return <span className="pill good">✓ read</span>;
  return <span className="pill">—</span>;
}

export function StatusDot({
  status,
  pulse,
}: {
  status: 'good' | 'warn' | 'bad' | '';
  pulse?: boolean;
}) {
  return <span className={`dot ${status} ${pulse ? 'pulse' : ''}`.trim()} />;
}

// ─────────────────────────────────────────────────────────────
// SCREEN HEAD / CARD / TABS
// ─────────────────────────────────────────────────────────────
export function ScreenHead({
  title,
  lede,
  meta,
  right,
}: {
  title: ReactNode;
  lede?: ReactNode;
  meta?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div className="screen-head">
      <div>
        <h1>{title}</h1>
        {lede && <p className="lede">{lede}</p>}
        {meta && <div className="meta">{meta}</div>}
      </div>
      {right && <div className="row">{right}</div>}
    </div>
  );
}

export function Card({
  title,
  right,
  tight,
  className,
  children,
}: {
  title?: ReactNode;
  right?: ReactNode;
  tight?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <section className={`card ${tight ? 'tight' : ''} ${className ?? ''}`.trim()}>
      {title && (
        <h3 className="card-title">
          <span>{title}</span>
          {right && <span className="right">{right}</span>}
        </h3>
      )}
      {children}
    </section>
  );
}

interface TabDef {
  id: string;
  label: string;
  count?: number;
}

export function Tabs({
  tabs,
  value,
  onChange,
}: {
  tabs: TabDef[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="tabs">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          className={`tab ${value === t.id ? 'active' : ''}`.trim()}
          onClick={() => onChange(t.id)}
        >
          {t.label}
          {t.count != null && (
            <span className="muted" style={{ marginLeft: 6 }}>
              ({t.count})
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// EMPTY STATE / SEARCH INPUT
// ─────────────────────────────────────────────────────────────
export function Empty({
  title,
  body,
  action,
}: {
  title: ReactNode;
  body?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="ti">{title}</div>
      {body && <div className="body">{body}</div>}
      {action}
    </div>
  );
}

export function SearchInput({
  value,
  onChange,
  placeholder,
  width = 260,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  width?: number;
}) {
  return (
    <div className="input-icon-wrap" style={{ width }}>
      <Icon name="search" size={16} className="ico" />
      <input
        className="input search"
        style={{ width: '100%' }}
        value={value}
        placeholder={placeholder ?? 'Search'}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// SEGMENTED BUTTON / FILTER CHIP / INPUT CHIP
// ─────────────────────────────────────────────────────────────
type SegOption = string | { value: string; label: string };

export function SegmentedButton({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: string;
  options: SegOption[];
  onChange: (v: string) => void;
  ariaLabel?: string;
}) {
  return (
    <div className="seg" role="group" aria-label={ariaLabel}>
      {options.map((opt) => {
        const v = typeof opt === 'string' ? opt : opt.value;
        const label = typeof opt === 'string' ? opt : opt.label;
        return (
          <button
            type="button"
            key={v}
            className={`seg-btn ${v === value ? 'active' : ''}`.trim()}
            onClick={() => onChange(v)}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

export function FilterChip({
  label,
  selected,
  onClick,
}: {
  label: ReactNode;
  selected?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      className={`fchip ${selected ? 'selected' : ''}`.trim()}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

export function InputChip({
  lead,
  label,
  onRemove,
}: {
  lead?: ReactNode;
  label: ReactNode;
  onRemove?: () => void;
}) {
  return (
    <span className="ichip">
      {lead && <span className="lead">{lead}</span>}
      <span>{label}</span>
      {onRemove && (
        <button type="button" className="close" onClick={onRemove}>
          <Icon name="x" size={14} />
        </button>
      )}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────
// SWITCH
// ─────────────────────────────────────────────────────────────
export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: ReactNode;
}) {
  const id = useId();
  return (
    <label className="row" style={{ gap: 10, cursor: 'pointer' }} htmlFor={id}>
      {label && <span style={{ fontSize: 13.5 }}>{label}</span>}
      <span className="switch">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="track" />
        <span className="thumb">
          <Icon name="check" size={14} />
        </span>
      </span>
    </label>
  );
}

// ─────────────────────────────────────────────────────────────
// EXTENDED FAB
// ─────────────────────────────────────────────────────────────
export function ExtendedFab({
  icon = 'plus',
  label,
  onClick,
}: {
  icon?: string;
  label: ReactNode;
  onClick?: () => void;
}) {
  return (
    <button type="button" className="efab" onClick={onClick}>
      <Icon name={icon} size={22} /> {label}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────
// DIALOG
// ─────────────────────────────────────────────────────────────
export function Dialog({
  open,
  icon,
  title,
  children,
  actions,
  onClose,
}: {
  open: boolean;
  icon?: string;
  title?: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  onClose?: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="dialog-scrim" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        {icon && <Icon name={icon} size={24} className="dialog-icon" />}
        {title && <h3>{title}</h3>}
        <div className="body">{children}</div>
        <div className="actions">{actions}</div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// MENU
// ─────────────────────────────────────────────────────────────
export interface MenuItem {
  icon?: string;
  label?: ReactNode;
  onClick?: () => void;
  divider?: boolean;
}

export function Menu({
  trigger,
  items,
  align = 'right',
}: {
  trigger: ReactNode;
  items: MenuItem[];
  align?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  const cloned = isValidElement(trigger)
    ? cloneElement(trigger as React.ReactElement<{ onClick?: () => void }>, {
        onClick: () => setOpen((o) => !o),
      })
    : trigger;
  return (
    <span className="menu-wrap" ref={ref}>
      {cloned}
      {open && (
        <div className="menu" style={align === 'left' ? { left: 0, right: 'auto' } : undefined}>
          {items.map((it, i) => {
            if (it.divider) return <div key={i} className="menu-divider" />;
            return (
              <button
                key={i}
                type="button"
                className="menu-item"
                onClick={() => {
                  setOpen(false);
                  it.onClick?.();
                }}
              >
                {it.icon && <Icon name={it.icon} size={20} />}
                {it.label}
              </button>
            );
          })}
        </div>
      )}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────
// BADGE
// ─────────────────────────────────────────────────────────────
export function Badge({
  count,
  dot,
  children,
}: {
  count?: number;
  dot?: boolean;
  children: ReactNode;
}) {
  return (
    <span className="badge-wrap">
      {children}
      {dot && <span className="badge-dot" />}
      {count != null && <span className="badge-num">{count > 99 ? '99+' : count}</span>}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────
// LINEAR PROGRESS
// ─────────────────────────────────────────────────────────────
export function LinearProgress({ value }: { value?: number }) {
  if (value != null) {
    return (
      <div
        className="linprog determinate"
        style={{ ['--progress' as keyof CSSProperties]: `${value}%` } as CSSProperties}
      />
    );
  }
  return <div className="linprog" />;
}

// ─────────────────────────────────────────────────────────────
// M3 LIST
// ─────────────────────────────────────────────────────────────
export function M3List({ children }: { children: ReactNode }) {
  return <div className="m3-list">{children}</div>;
}

export function M3ListItem({
  lead,
  leadKind,
  headline,
  supporting,
  trailing,
  onClick,
  style,
}: {
  lead?: ReactNode;
  leadKind?: '' | 'primary' | 'secondary' | 'tertiary' | 'success' | 'warning' | 'error';
  headline?: ReactNode;
  supporting?: ReactNode;
  trailing?: ReactNode;
  onClick?: () => void;
  style?: CSSProperties;
}) {
  return (
    <div className="m3-list-item" onClick={onClick} style={style}>
      <div className={`lead ${leadKind ?? ''}`.trim()}>{lead}</div>
      <div>
        <div className="head">{headline}</div>
        {supporting && <div className="supp">{supporting}</div>}
      </div>
      <div className="tail">{trailing}</div>
    </div>
  );
}

export function M3ListSubheader({ children }: { children: ReactNode }) {
  return <div className="m3-list-subheader">{children}</div>;
}

// ─────────────────────────────────────────────────────────────
// SNACKBAR — context + provider
// ─────────────────────────────────────────────────────────────
import { createContext, useCallback, useContext } from 'react';

interface ToastPayload {
  msg: string;
  actionLabel?: string;
  action?: () => void;
  kind?: '' | 'error';
}

interface SnackbarContextValue {
  show: (t: ToastPayload) => void;
}

const SnackbarCtx = createContext<SnackbarContextValue | null>(null);

export function useSnackbar() {
  const ctx = useContext(SnackbarCtx);
  if (!ctx) {
    return {
      show: () => {
        /* noop when provider absent */
      },
    };
  }
  return ctx;
}

export function SnackbarProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastPayload | null>(null);
  const show = useCallback((t: ToastPayload) => setToast(t), []);
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(id);
  }, [toast]);
  return (
    <SnackbarCtx.Provider value={{ show }}>
      {children}
      {toast && (
        <div className={`snackbar ${toast.kind ?? ''}`.trim()}>
          <span className="msg">{toast.msg}</span>
          {toast.action && toast.actionLabel && (
            <button
              type="button"
              className="action"
              onClick={() => {
                toast.action?.();
                setToast(null);
              }}
            >
              {toast.actionLabel}
            </button>
          )}
          <button type="button" className="close" onClick={() => setToast(null)}>
            <Icon name="x" size={16} />
          </button>
        </div>
      )}
    </SnackbarCtx.Provider>
  );
}
