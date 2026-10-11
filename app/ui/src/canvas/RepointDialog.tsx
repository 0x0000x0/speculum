import "./ConnectDialog.css";

export interface RepointInfo {
  connName: string;
  targetName: string;
  screenX: number;
  screenY: number;
}

export default function RepointDialog({
  info,
  onChoice,
}: {
  info: RepointInfo;
  onChoice: (mode: "change" | "new" | null) => void;
}) {
  const style = {
    left: Math.min(info.screenX, window.innerWidth - 320),
    top: Math.min(info.screenY, window.innerHeight - 300),
  };
  return (
    <div
      className="connect-dialog"
      style={style}
      role="dialog"
      aria-label="Re-point link"
      data-testid="repoint-dialog"
    >
      <div className="connect-dialog__ends">
        Point “{info.connName}” at {info.targetName}?
      </div>
      <div className="connect-dialog__actions">
        <button
          type="button"
          className="connect-dialog__cancel"
          data-testid="repoint-cancel"
          onClick={() => onChoice(null)}
        >
          Cancel
        </button>
        <button
          type="button"
          className="connect-dialog__cancel"
          data-testid="repoint-new"
          onClick={() => onChoice("new")}
        >
          Create a new connection (keep the old one)
        </button>
        <button
          type="button"
          className="connect-dialog__create"
          data-testid="repoint-change"
          onClick={() => onChoice("change")}
        >
          Change this connection in the model
        </button>
      </div>
    </div>
  );
}
