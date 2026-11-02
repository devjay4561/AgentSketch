import {defineConfig} from 'vite';
export default defineConfig({server:{watch:{ignored:['**/output/**','**/release/**','**/.tools/**','**/build/bin/**']}},build:{rollupOptions:{input:{main:'index.html',render:'render.html'}}}});
