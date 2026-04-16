import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import "katex/dist/katex.min.css";
import "katex/contrib/mhchem";
import "@/lib/i18n";

createRoot(document.getElementById("root")!).render(<App />);
