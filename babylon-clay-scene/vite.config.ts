import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import path from 'path';
import fs from 'fs';

export default defineConfig({
  plugins: [
    tailwindcss(),
    {
      name: 'serve-parent-models',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url?.startsWith('/models/')) {
            const filePath = path.resolve(__dirname, '..', req.url.slice(1));
            if (fs.existsSync(filePath)) {
              res.setHeader('Content-Type', 'application/octet-stream');
              fs.createReadStream(filePath).pipe(res);
              return;
            }
          }
          next();
        });
      },
    },
  ],
  server: {
    port: 3000,
  },
  optimizeDeps: {
    exclude: ["@babylonjs/havok"],
  },
  build: {
    target: 'esnext',
  },
}); 
