import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import App from "./App";
import "./styles.css";

class ApplicationBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) {
      return (
        <main className="panel">
          <h1>Interface recovery required</h1>
          <p>No action is assumed to have succeeded. Reload, then inspect the audit trail.</p>
          <button onClick={() => window.location.reload()}>RELOAD APPLICATION</button>
        </main>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ApplicationBoundary>
      <HashRouter><App /></HashRouter>
    </ApplicationBoundary>
  </React.StrictMode>
);
