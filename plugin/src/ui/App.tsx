import React, { useEffect, useMemo, useRef, useState } from "react";
import hoppLogo from "./assets/hopp-logo.png";

type RequestType =
  | "get_document"
  | "get_selection"
  | "get_node"
  | "get_styles"
  | "get_metadata"
  | "get_design_context"
  | "get_variable_defs"
  | "get_screenshot"
  | "set_node_visibility"
  | "set_text_content"
  | "set_text_properties"
  | "set_node_properties"
  | "set_solid_fill"
  | "set_gradient_fill"
  | "set_effects"
  | "set_stroke_properties"
  | "set_auto_layout"
  | "create_frame"
  | "create_text"
  | "create_shape"
  | "create_image"
  | "duplicate_nodes"
  | "reparent_nodes"
  | "group_nodes"
  | "ungroup_node"
  | "set_selection"
  | "scroll_and_zoom_into_view"
  | "delete_nodes"
  | "create_component_from_node"
  | "combine_as_variants"
  | "set_reactions";

type ServerRequest = {
  type: RequestType;
  requestId: string;
  nodeIds?: string[];
  params?: Record<string, unknown>;
};

type PluginResponse = {
  type: RequestType;
  requestId: string;
  data?: unknown;
  error?: string;
};

type PluginStatus = {
  fileName: string;
  fileKey: string;
  selectionCount: number;
};

// `||` (not `??`) so an empty build-time value falls back to the default.
// A custom endpoint must also be listed in manifest.json's
// networkAccess.allowedDomains or Figma will block the connection.
const WS_BASE_URL = import.meta.env.VITE_FIGMA_BRIDGE_WS || "ws://localhost:1994/ws";

export default function App() {
  const [connected, setConnected] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [status, setStatus] = useState<PluginStatus>({
    fileName: "Unknown file",
    fileKey: "",
    selectionCount: 0,
  });
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<number | null>(null);

  const statusLabel = useMemo(
    () => (connected ? "WebSocket Connected" : "Disconnected"),
    [connected]
  );

  // One definition, rendered either in the collapsed bar or in the footer --
  // never both at once, since .body is hidden while collapsed.
  const statusBadge = (
    <div className={`badge ${connected ? "connected" : "disconnected"}`}>
      <span className="dot" />
      <span className="badge-text">{statusLabel}</span>
    </div>
  );

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const msg = event.data?.pluginMessage;
      if (!msg) return;

      if (msg.type === "plugin-status") {
        setStatus(msg.payload);
        return;
      }

      if (msg.type === "ui-collapse-state") {
        setCollapsed(msg.payload?.collapsed === true);
        return;
      }

      if (!("requestId" in msg)) {
        return;
      }

      if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
        return;
      }
      socketRef.current.send(JSON.stringify(msg));
    };

    window.addEventListener("message", handleMessage);
    // The main thread reads the persisted state asynchronously, so ask for it
    // on mount rather than relying on a broadcast we may have missed.
    parent.postMessage({ pluginMessage: { type: "request-ui-state" } }, "*");
    return () => {
      window.removeEventListener("message", handleMessage);
    };
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((previous) => {
      const next = !previous;
      parent.postMessage({ pluginMessage: { type: "set-ui-collapsed", collapsed: next } }, "*");
      return next;
    });
  };

  // Connect/reconnect WebSocket when fileKey changes
  useEffect(() => {
    if (!status.fileKey) return;

    let disposed = false;

    const connect = () => {
      if (disposed) return;

      if (socketRef.current) {
        const previousSocket = socketRef.current;
        previousSocket.onopen = null;
        previousSocket.onclose = null;
        previousSocket.onerror = null;
        previousSocket.onmessage = null;
        previousSocket.close();
      }

      const wsUrl = `${WS_BASE_URL}?fileKey=${encodeURIComponent(status.fileKey)}&fileName=${encodeURIComponent(status.fileName)}`;
      const ws = new WebSocket(wsUrl);
      socketRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        parent.postMessage({ pluginMessage: { type: "ui-ready" } }, "*");
      };

      ws.onclose = () => {
        if (disposed || socketRef.current !== ws) return;
        setConnected(false);
        if (reconnectTimer.current === null) {
          reconnectTimer.current = window.setTimeout(() => {
            reconnectTimer.current = null;
            connect();
          }, 1500);
        }
      };

      ws.onerror = () => {
        if (disposed || socketRef.current !== ws) return;
        setConnected(false);
      };

      ws.onmessage = (event) => {
        if (disposed || socketRef.current !== ws) return;
        const payload = JSON.parse(event.data) as ServerRequest;
        parent.postMessage({ pluginMessage: { type: "server-request", payload } }, "*");
      };
    };

    connect();

    return () => {
      disposed = true;
      if (reconnectTimer.current !== null) {
        window.clearTimeout(reconnectTimer.current);
        reconnectTimer.current = null;
      }
      if (socketRef.current) {
        const ws = socketRef.current;
        ws.onopen = null;
        ws.onclose = null;
        ws.onerror = null;
        ws.onmessage = null;
        ws.close();
        socketRef.current = null;
      }
    };
  }, [status.fileKey, status.fileName]);

  return (
    <div className={`container ${collapsed ? "collapsed" : ""}`}>
      {collapsed && <div className="titlebar">{statusBadge}</div>}

      <button
        type="button"
        className="collapse-toggle"
        onClick={toggleCollapsed}
        title={collapsed ? "Restore" : "Minimize"}
        aria-label={collapsed ? "Restore" : "Minimize"}
        aria-expanded={!collapsed}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path
            d="M1 3.5 L5 7 L9 3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      <div className="body">
        <div className="info-section">
          <div className="info-row">
            <span className="info-label">File:</span>
            <span className="info-value">{status.fileName}</span>
          </div>
          <div className="info-row">
            <span className="info-label">Selection:</span>
            <span className="info-value">{status.selectionCount} node(s)</span>
          </div>
        </div>

        <div className="footer">
          {statusBadge}
          <a
            href="https://www.gethopp.app/?ref=figma-mcp-bridge"
            target="_blank"
            rel="noopener noreferrer"
            className="branding"
          >
            <img src={hoppLogo} alt="Hopp" className="logo" />
            <span className="sponsored-text">
              Sponsored by Hopp
              <br />
              The best open-source
              <br />
              pair-programming app
            </span>
          </a>
        </div>
      </div>
    </div>
  );
}
