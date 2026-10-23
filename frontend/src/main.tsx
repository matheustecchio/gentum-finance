import React from "react";
import ReactDOM from "react-dom/client";
import { DesktopStartup } from "./app/DesktopStartup";
import { App } from "./app/App";
import { AppProviders } from "./app/providers";
import "./styles/global.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <DesktopStartup>
      <AppProviders>
        <App />
      </AppProviders>
    </DesktopStartup>
  </React.StrictMode>,
);
