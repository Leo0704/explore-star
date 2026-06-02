import { defineConfig } from "vite";
import { resolve } from "path";
import { readFileSync } from "fs";
const pkg = JSON.parse(readFileSync(resolve(__dirname, "package.json"), "utf-8"));
const compatRange = pkg.opencli?.compatRange ?? ">=0.0.0";
var vite_config_default = defineConfig({
  define: {
    __OPENCLI_COMPAT_RANGE__: JSON.stringify(compatRange)
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, "src/background.ts"),
      output: {
        entryFileNames: "background.js",
        format: "es"
      }
    },
    target: "esnext",
    minify: false
  }
});
export {
  vite_config_default as default
};
