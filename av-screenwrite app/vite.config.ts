import { defineConfig } from 'vitest/config';

// Tauri ожидает фиксированный порт dev-сервера (см. src-tauri/tauri.conf.json).
export default defineConfig({
  clearScreen: false,
  // Не следить за Rust-сборкой: иначе на Windows сыпятся ошибки EBUSY от target/.
  server: { port: 1420, strictPort: true, watch: { ignored: ['**/src-tauri/**'] } },
  build: { target: 'es2022', sourcemap: false },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
});
