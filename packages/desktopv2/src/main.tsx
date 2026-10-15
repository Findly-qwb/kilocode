import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { mount } from "./dev/walk";
import "./styles/base.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// dev 下暴露 __walk()：逐屏验证装置，和验证原型时同一套路
if (import.meta.env.DEV) mount();
