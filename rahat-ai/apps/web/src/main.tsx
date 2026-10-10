import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import JourneyRoot from "./journey/UltraJourneyApp";
import "./styles.css";

// One RAHAT AI application. JourneyRoot owns the sidebar, shared journey state and every route
// (including redirects for the retired Pune-era URLs), so it is mounted once at a catch-all.
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter basename="/rahat">
      <Routes>
        <Route path="/*" element={<JourneyRoot />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
