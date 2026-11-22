import { useEffect, useId, useRef, useState, type ReactNode, type MouseEvent as ReactMouseEvent } from "react";
import { useForm } from "react-hook-form";
import { X, WarningCircle, SpinnerGap } from "@phosphor-icons/react";
import { classNames } from "../utils";

export function Button({
  children,
  variant = "primary",
  size = "md",
  loading = false,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
  loading?: boolean;
}) {
  return (
    <button
      {...props}
      disabled={props.disabled || loading}
      className={classNames("button", `button-${variant}`, `button-${size}`, className)}
    >
      {loading ? <SpinnerGap className="spin" size={16} aria-hidden /> : null}
      {children}
    </button>
  );
}

export function IconButton({ label, children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string; children: ReactNode }) {
  return <button className="icon-button" aria-label={label} title={label} {...props}>{children}</button>;
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "accent" | "success" | "warning" | "danger" }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <div className="empty-state">
      <div className="empty-mark" />
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="error-state" role="alert">
      <WarningCircle size={22} />
      <div><strong>暂时无法完成操作</strong><p>{message}</p></div>
      {onRetry ? <Button variant="secondary" size="sm" onClick={onRetry}>重试</Button> : null}
    </div>
  );
}

export function Skeleton({ lines = 4 }: { lines?: number }) {
  return <div className="skeleton-stack" aria-label="正在加载">{Array.from({ length: lines }, (_, index) => <div className="skeleton-line" key={index} />)}</div>;
}

export function Modal({ title, description, open, onClose, children, wide = false, draggable = false }: {
  title: string;
  description?: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  draggable?: boolean;
}) {
  const modalRef = useRef<HTMLElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const [drag, setDrag] = useState({ x: 0, y: 0 });
  const dragStart = useRef<{ mx: number; my: number; dx: number; dy: number } | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => {
      const first = modalRef.current?.querySelector<HTMLElement>("[autofocus]")
        ?? modalRef.current?.querySelector<HTMLElement>("button, input, textarea, select, [tabindex]:not([tabindex='-1'])");
      first?.focus();
    });
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseRef.current();
      if (event.key !== "Tab" || !modalRef.current) return;
      const focusable = [...modalRef.current.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex='-1'])")];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", handler);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handler);
      previousFocus?.focus();
    };
  }, [open]);
  // 每次打开时把拖动偏移归零
  useEffect(() => {
    if (open) setDrag({ x: 0, y: 0 });
  }, [open]);
  // 需要时可拖动：按住标题栏拖动整窗
  useEffect(() => {
    if (!draggable || !open) return;
    const onMove = (event: MouseEvent) => {
      if (!dragStart.current) return;
      const { mx, my, dx, dy } = dragStart.current;
      setDrag({ x: dx + (event.clientX - mx), y: dy + (event.clientY - my) });
    };
    const onUp = () => { dragStart.current = null; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [draggable, open]);
  if (!open) return null;
  const headerDown = (event: ReactMouseEvent) => {
    if (!draggable) return;
    if ((event.target as HTMLElement).closest("button")) return;
    dragStart.current = { mx: event.clientX, my: event.clientY, dx: drag.x, dy: drag.y };
    event.preventDefault();
  };
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section
        ref={modalRef}
        className={classNames("modal", "glass-regular", wide && "modal-wide", draggable && "modal-draggable")}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        style={draggable ? { position: "relative", left: drag.x, top: drag.y } : undefined}
      >
        <header className="modal-header" onMouseDown={headerDown} style={draggable ? { cursor: "move", userSelect: "none" } : undefined}>
          <div><h2 id={titleId}>{title}</h2>{description ? <p id={descriptionId}>{description}</p> : null}</div>
          <IconButton label="关闭" onClick={onClose}><X size={20} /></IconButton>
        </header>
        {children}
      </section>
    </div>
  );
}

export type FieldDefinition = {
  name: string;
  label: string;
  type?: "text" | "textarea" | "date" | "time" | "datetime-local" | "number" | "select" | "checkbox";
  required?: boolean;
  placeholder?: string;
  helper?: string;
  options?: Array<{ value: string; label: string }>;
  step?: string;
};

export function EntityForm({
  fields,
  initial = {},
  submitLabel = "保存",
  onSubmit,
  onCancel,
}: {
  fields: FieldDefinition[];
  initial?: Record<string, any>;
  submitLabel?: string;
  onSubmit: (values: Record<string, any>) => Promise<void>;
  onCancel: () => void;
}) {
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm({ defaultValues: initial });
  const submit = handleSubmit(async (values) => {
    const normalized = Object.fromEntries(fields.map((field) => {
      const value = values[field.name];
      if (field.type === "number") return [field.name, value === "" || value === undefined ? null : Number(value)];
      if (field.type === "checkbox") return [field.name, Boolean(value)];
      return [field.name, value ?? ""];
    }));
    await onSubmit(normalized);
  });
  return (
    <form className="entity-form" onSubmit={submit}>
      <div className="form-grid">
        {fields.map((field) => {
          const invalid = Boolean(errors[field.name]);
          return (
          <label className={classNames("form-field", field.type === "textarea" && "form-field-wide")} key={field.name}>
            <span>{field.label}{field.required ? <em>必填</em> : null}</span>
            {field.type === "textarea" ? (
              <textarea rows={4} aria-invalid={invalid} placeholder={field.placeholder} {...register(field.name, { required: field.required ? "请填写此项" : false })} />
            ) : field.type === "select" ? (
              <select aria-invalid={invalid} {...register(field.name, { required: field.required ? "请选择此项" : false })}>
                <option value="">请选择</option>
                {field.options?.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            ) : field.type === "checkbox" ? (
              <input type="checkbox" {...register(field.name)} />
            ) : (
              <input type={field.type ?? "text"} step={field.step} aria-invalid={invalid} placeholder={field.placeholder} {...register(field.name, { required: field.required ? "请填写此项" : false })} />
            )}
            {field.helper ? <small>{field.helper}</small> : null}
            {invalid ? <small className="field-error"><WarningCircle size={12} weight="fill" aria-hidden />{String(errors[field.name]?.message)}</small> : null}
          </label>
          );
        })}
      </div>
      <footer className="modal-actions">
        <Button type="button" variant="ghost" onClick={onCancel}>取消</Button>
        <Button type="submit" loading={isSubmitting}>{submitLabel}</Button>
      </footer>
    </form>
  );
}

export function ConfirmDialog({ open, title, description, confirmLabel = "确认", danger = false, onConfirm, onClose }: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => Promise<void> | void;
  onClose: () => void;
}) {
  return (
    <Modal open={open} title={title} description={description} onClose={onClose}>
      <footer className="modal-actions">
        <Button variant="ghost" onClick={onClose}>取消</Button>
        <Button variant={danger ? "danger" : "primary"} onClick={async () => { await onConfirm(); onClose(); }}>{confirmLabel}</Button>
      </footer>
    </Modal>
  );
}

export function PageHeader({ eyebrow, title, description, icon, actions }: { eyebrow?: string; title: string; description: string; icon?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="page-header">
      <div className="page-heading">
        {icon ? <span className="page-header-icon" aria-hidden="true">{icon}</span> : null}
        <div className="page-heading-copy">{eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}<h1>{title}</h1><p>{description}</p></div>
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
      <span className="page-header-sticker" aria-hidden="true" />
    </header>
  );
}

export function Section({ title, description, action, children, className }: { title: string; description?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={classNames("section", "frosted-content", className)}>
      <header className="section-header"><div><h2>{title}</h2>{description ? <p>{description}</p> : null}</div>{action}</header>
      {children}
    </section>
  );
}
