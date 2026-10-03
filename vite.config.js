export default ({ command }) => ({
  base: command === 'serve' ? '/' : (process.env.BASE_PATH || '/jelly-study/'),
  build: { outDir: 'docs', emptyOutDir: true },
  server: { host: '0.0.0.0' },
});
