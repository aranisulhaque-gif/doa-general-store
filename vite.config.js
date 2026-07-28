import { defineConfig } from 'vite';

export default defineConfig({
    base: '/doa-general-store/',
    root: './',
    build: {
        outDir: 'dist',
        rollupOptions: {
            input: {
                main: './index.html',
            },
        },
    },
    server: {
        open: true,
    },
});
