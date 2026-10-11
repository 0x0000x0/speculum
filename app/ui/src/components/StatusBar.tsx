import { useSessionStatus } from "../session/status";
import { useModel } from "../model/store";
import "./StatusBar.css";

export default function StatusBar({ zoom }: { zoom: number }) {
  const status = useSessionStatus();
  const { connectMode } = useModel();
  const pct = `${Math.round(zoom * 100)}%`;

  return (
    <footer className="statusbar" aria-label="Status bar">
      <span className="statusbar__save">
        <span
          className="statusbar__dot"
          aria-hidden="true"
        />
        {status.savedLabel}
      </span>
      {connectMode != null && (
        <span
          className="statusbar__hint"
          data-testid="connect-hint"
          role="status"
        >
          Connect: click source, then target · Esc to cancel
        </span>
      )}
      <span
        className="statusbar__zoom"
        data-testid="status-zoom"
        aria-label={`Zoom ${pct}`}
      >
        {pct}
      </span>
      <span className="statusbar__counts" data-testid="status-counts">
        {status.objects} objects · {status.links} links · {status.flows} flows
      </span>
    </footer>
  );
}
