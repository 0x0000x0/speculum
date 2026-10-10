import { useCallback, useEffect, useMemo, useState } from "react";
import TopBar from "./components/TopBar";
import SidePanel from "./components/SidePanel";
import StatusBar from "./components/StatusBar";
import Modal from "./components/Modal";
import Button from "./components/Button";
import FlowCanvas from "./canvas/FlowCanvas";
import TokenSheet from "./pages/TokenSheet";
import { SAMPLE_NODES } from "./data/sample";
import { SessionProvider, useSession } from "./session/SessionProvider";
import "./App.css";

function readParam(name: string): string | null {
  try {
    return new URLSearchParams(window.location.search).get(name);
  } catch {
    return null;
  }
}

function Shell() {
  // M3 demo entry state: Payments API selected so the panel has content.
  const [selectedId, setSelectedId] = useState<string | null>("payments");
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const [zoom, setZoom] = useState(1);
  const tokenPage = useMemo(() => readParam("page") === "tokens", []);
  const session = useSession();

  const selectedNode = useMemo(
    () => SAMPLE_NODES.find((n) => n.id === selectedId) ?? null,
    [selectedId],
  );

  const togglePanel = useCallback(() => setPanelCollapsed((c) => !c), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inField =
        target !== null &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        togglePanel();
        return;
      }
      if (inField) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) {
          void session.redo();
        } else {
          void session.undo();
        }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        void session.redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePanel, session]);

  const showRecovery =
    session.status === "needs_recovery" && session.recovery !== null;
  const pendingCount = session.recovery?.pendingCommands ?? 0;

  return (
    <div className="app-shell">
      <TopBar />
      <div className="app-main">
        {tokenPage ? (
          <TokenSheet />
        ) : (
          <FlowCanvas onSelect={setSelectedId} onZoom={setZoom} />
        )}
        <SidePanel
          node={selectedNode}
          collapsed={panelCollapsed}
          onToggle={togglePanel}
        />
      </div>
      <StatusBar zoom={zoom} />
      {showRecovery && (
        <Modal
          title="Recovered unsaved changes"
          body={`Speculum closed unexpectedly. ${pendingCount} unsaved changes were recovered.`}
          onClose={() => void session.resolveRecovery("discard")}
          actions={
            <>
              <Button
                variant="secondary"
                onClick={() => void session.resolveRecovery("discard")}
              >
                Discard
              </Button>
              <Button
                variant="primary"
                onClick={() => void session.resolveRecovery("restore")}
              >
                Restore
              </Button>
            </>
          }
        />
      )}
    </div>
  );
}

export default function App() {
  return (
    <SessionProvider>
      <Shell />
    </SessionProvider>
  );
}
