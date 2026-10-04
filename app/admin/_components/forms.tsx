"use client";
import { useActionState, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useFormStatus } from "react-dom";
import { X } from "lucide-react";

export type ActionState = { ok: boolean; message: string; at?: number } | null;
export type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

export type ConfirmSpec = { title: string; body?: ReactNode; confirmLabel?: string; danger?: boolean };

function Dialog({ title, description, children, footer, onClose }: {
  title: string; description?: ReactNode; children?: ReactNode; footer?: ReactNode; onClose: () => void;
}) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>("input, select, textarea, button:not([data-close])");
    first?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, [onClose]);
  return createPortal(
    <div className="ad-root-portal">
      <div className="ad-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
        <div className="ad-dialog" role="dialog" aria-modal="true" aria-labelledby={id} ref={ref}>
          <header>
            <div>
              <h2 id={id}>{title}</h2>
              {description && <p>{description}</p>}
            </div>
            <button type="button" className="ad-btn ad-btn-ghost ad-icon-btn" onClick={onClose} aria-label="Close" data-close><X aria-hidden /></button>
          </header>
          {children}
          {footer}
        </div>
      </div>
    </div>,
    document.querySelector(".ad-root") || document.body,
  );
}

export function SubmitButton({ children, className = "ad-btn ad-btn-primary", pendingLabel = "Saving…", disabled }: {
  children: ReactNode; className?: string; pendingLabel?: string; disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  return <button className={className} disabled={pending || disabled}>{pending ? pendingLabel : children}</button>;
}

function Toast({ state }: { state: ActionState }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!state) return;
    setVisible(true);
    const t = setTimeout(() => setVisible(false), 4200);
    return () => clearTimeout(t);
  }, [state]);
  if (!state || !visible) return null;
  return createPortal(
    <div className={`ad-toast${state.ok ? "" : " bad"}`} role="status" aria-live="polite">{state.message}</div>,
    document.querySelector(".ad-root") || document.body,
  );
}

/**
 * Server-action form with pending state, toast feedback and an optional confirmation step.
 * The server action re-validates everything; the confirmation is a UX safeguard only.
 */
export function ActionForm({ action, children, className, confirm, onSuccess, toast = true, inline, resetOnSuccess }: {
  action: Action;
  children: ReactNode;
  className?: string;
  confirm?: ConfirmSpec;
  onSuccess?: () => void;
  toast?: boolean;
  inline?: boolean;
  resetOnSuccess?: boolean;
}) {
  const [state, formAction] = useActionState(action, null);
  const [asking, setAsking] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const confirmed = useRef(false);
  useEffect(() => {
    if (!state?.ok) return;
    if (resetOnSuccess) formRef.current?.reset();
    onSuccess?.();
  }, [state, onSuccess, resetOnSuccess]);
  return (
    <>
      <form
        ref={formRef}
        action={formAction}
        className={className}
        onSubmit={(e) => {
          if (confirm && !confirmed.current) {
            e.preventDefault();
            setAsking(true);
          }
          confirmed.current = false;
        }}
      >
        {children}
        {inline && state && <span className={`ad-form-msg ${state.ok ? "good" : "bad"}`} role="status">{state.message}</span>}
      </form>
      {toast && !inline && <Toast state={state} />}
      {asking && confirm && (
        <Dialog
          title={confirm.title}
          description={confirm.body}
          onClose={() => setAsking(false)}
          footer={
            <footer>
              <button type="button" className="ad-btn" onClick={() => setAsking(false)}>Cancel</button>
              <button
                type="button"
                className={`ad-btn ${confirm.danger ? "ad-btn-danger" : "ad-btn-primary"}`}
                onClick={() => {
                  confirmed.current = true;
                  setAsking(false);
                  formRef.current?.requestSubmit();
                }}
              >
                {confirm.confirmLabel || "Confirm"}
              </button>
            </footer>
          }
        />
      )}
    </>
  );
}

/** Button that opens a dialog containing a server-action form. Closes on success. */
export function ModalForm({ trigger, triggerClassName = "ad-btn", title, description, action, children, submitLabel = "Save", danger, disabled }: {
  trigger: ReactNode;
  triggerClassName?: string;
  title: string;
  description?: ReactNode;
  action: Action;
  children: ReactNode;
  submitLabel?: string;
  danger?: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(action, null);
  const [lastToast, setLastToast] = useState<ActionState>(null);
  useEffect(() => {
    if (state?.ok) {
      setOpen(false);
      setLastToast(state);
    }
  }, [state]);
  return (
    <>
      <button type="button" className={triggerClassName} onClick={() => setOpen(true)} disabled={disabled}>{trigger}</button>
      <Toast state={lastToast} />
      {open && (
        <Dialog title={title} description={description} onClose={() => setOpen(false)}>
          <form action={formAction}>
            <div className="ad-dialog-body">
              {children}
              {state && !state.ok && <p className="ad-form-msg bad" role="alert" style={{ margin: 0 }}>{state.message}</p>}
            </div>
            <footer>
              <button type="button" className="ad-btn" onClick={() => setOpen(false)}>Cancel</button>
              <SubmitButton className={`ad-btn ${danger ? "ad-btn-danger" : "ad-btn-primary"}`}>{submitLabel}</SubmitButton>
            </footer>
          </form>
        </Dialog>
      )}
    </>
  );
}

/** Accessible switch that submits a server action, with confirmation for high-impact changes. */
export function SwitchForm({ action, name, value, checked, label, confirm, disabled, hidden }: {
  action: Action;
  name: string;
  value: string;
  checked: boolean;
  label: string;
  confirm?: ConfirmSpec;
  disabled?: boolean;
  hidden?: Record<string, string>;
}) {
  return (
    <ActionForm action={action} confirm={confirm}>
      <input type="hidden" name={name} value={value} />
      {Object.entries(hidden || {}).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <SwitchButton checked={checked} label={label} disabled={disabled} />
    </ActionForm>
  );
}

function SwitchButton({ checked, label, disabled }: { checked: boolean; label: string; disabled?: boolean }) {
  const { pending } = useFormStatus();
  return <button className="ad-switch" role="switch" aria-checked={checked} aria-label={label} disabled={disabled || pending} />;
}
