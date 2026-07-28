import { defineConfig } from 'vite';

export default defineConfig({
    base: '/',
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
