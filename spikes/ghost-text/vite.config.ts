import { defineConfig } from "vite";

// The spike imports the app's src/univer-document.ts for the export check, so
// its Univer and React imports must resolve to the spike's own copies.
export default defineConfig({
  resolve: { dedupe: ["@univerjs/presets", "@univerjs/preset-docs-core", "react", "react-dom", "rxjs"] },
  build: { target: "es2022", chunkSizeWarningLimit: 10_000, minify: false },
});
