import { useCallback, useEffect, useMemo, useState } from "react";
import TopBar from "./components/TopBar";
import SidePanel from "./components/SidePanel";
import StatusBar from "./components/StatusBar";
import Modal from "./components/Modal";
import Button from "./components/Button";
import FlowCanvas from "./canvas/FlowCanvas";
import ErrorBoundary from "./components/ErrorBoundary";
import QuickAdd from "./canvas/QuickAdd";
import TokenSheet from "./pages/TokenSheet";
import { SessionProvider, useSession } from "./session/SessionProvider";
import {
  bootModel,
  clearToast,
  newObjectId,
  seedModel,
  syncIfStale,
  undoModel,
  useModel,
} from "./model/store";
import { bridgeDispatch } from "./session/bridge";
import { applySessionCounts } from "./session/SessionProvider";
import "./App.css";

function readParam(name: string): string | null {
  try {
    return new URLSearchParams(window.location.search).get(name);
  } catch {
    return null;
  }
}

let shellRenderMarked = false;
function Shell() {
  if (!shellRenderMarked) {
    shellRenderMarked = true;
    try {
      performance.mark("speculum:shell-render");
    } catch {
      /* ignore */
    }
  }
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const [zoom, setZoom] = useState(1);
  const tokenPage = useMemo(() => readParam("page") === "tokens", []);
  const session = useSession();
  const model = useModel();

  const togglePanel = useCallback(() => setPanelCollapsed((c) => !c), []);

  // Boot the document store once the session is clean.
  useEffect(() => {
    if (session.status === "clean") void bootModel();
  }, [session.status]);

  // Follow backend rev changes (undo/redo from any path).
  useEffect(() => {
    if (session.status !== "clean" || model.status !== "ready") return;
    const t = window.setInterval(() => void syncIfStale(), 1000);
    return () => window.clearInterval(t);
  }, [session.status, model.status]);

  // Auto-dismiss toasts.
  useEffect(() => {
    if (model.toast == null) return;
    const t = window.setTimeout(() => clearToast(), 6000);
    return () => window.clearTimeout(t);
  }, [model.toast]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        togglePanel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePanel]);

  const showRecovery =
    session.status === "needs_recovery" && session.recovery !== null;
  const pendingCount = session.recovery?.pendingCommands ?? 0;

  const emptyModel =
    model.status === "ready" &&
    Object.keys(model.doc.model.objects).length === 0;
  const emptyDiagram =
    model.status === "ready" &&
    model.view != null &&
    Object.keys(model.view.diagram.boxes).length === 0;

  const addFirstSystem = useCallback(() => {
    const id = newObjectId();
    void (async () => {
      const counts = await bridgeDispatch({
        op: "batch",
        commands: [
          {
            op: "createObject",
            object: {
              id,
              name: "New System",
              type: "system",
              parentId: null,
              status: "live",
              external: false,
              caption: "",
              description: "",
              tagIds: [],
              technologies: [],
              links: [],
              groupIds: [],
              labels: {},
            },
          },
          {
            op: "createDiagram",
            diagram: {
              id: "dg-first",
              name: "Shop Landscape",
              level: "context",
              scopeObjectId: null,
              description: "",
              order: 0,
              pinned: false,
              boxes: { [id]: { x: 64, y: 64, w: 240, h: 120 } },
              connections: {},
              landing: {},
              autoPlaced: false,
              showAllLabels: false,
              created: "",
              modified: "",
            },
          },
        ],
      });
      applySessionCounts(counts);
      await bootModel();
    })();
  }, []);

  return (
    <div className="app-shell">
      <TopBar />
      <div className="app-main">
        {tokenPage ? (
          <TokenSheet />
        ) : emptyModel ? (
          <div className="empty-state">
            <div className="empty-state__card" role="status">
              <h2 className="empty-state__title">Start your map</h2>
              <p className="empty-state__body">
                Create your first system, or open a made-up sample to explore.
              </p>
              <div className="empty-state__actions">
                <Button
                  variant="primary"
                  data-testid="empty-add-system"
                  onClick={addFirstSystem}
                >
                  Add first system
                </Button>
                <Button
                  variant="secondary"
                  data-testid="empty-open-sample"
                  onClick={() => void seedModel()}
                >
                  Open sample
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <ErrorBoundary label="Canvas">
            <FlowCanvas onZoom={setZoom} />
          </ErrorBoundary>
        )}
        {emptyDiagram && (
          <div className="empty-diagram-hint" role="status">
            Double-click to add a box
          </div>
        )}
        <QuickAdd />
        <SidePanel collapsed={panelCollapsed} onToggle={togglePanel} />
      </div>
      <StatusBar zoom={zoom} />
      {model.toast != null && (
        <div className="app-toast" role="status">
          <span>{model.toast}</span>
          {model.toastUndo && (
            <Button
              variant="ghost"
              onClick={() => {
                clearToast();
                void undoModel();
              }}
            >
              Undo
            </Button>
          )}
        </div>
      )}
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
      <ErrorBoundary label="App">
        <Shell />
      </ErrorBoundary>
    </SessionProvider>
  );
}
