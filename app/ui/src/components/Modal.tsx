import { useEffect, useRef } from "react";
import "./Modal.css";
import Button from "./Button";

interface ModalProps {
  title: string;
  body: string;
  onClose: () => void;
  actions?: React.ReactNode;
}

/**
 * Reusable modal dialog (M3 demo shell; M2 reuses it for real flows).
 * Closes on Escape and on backdrop click. Focus lands on the dialog.
 */
export default function Modal({ title, body, onClose, actions }: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dialogRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="sp-modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="sp-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
      >
        <h2 className="sp-modal__title">{title}</h2>
        <p className="sp-modal__body">{body}</p>
        <div className="sp-modal__actions">
          {actions ?? (
            <Button variant="primary" onClick={onClose}>
              Close
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
