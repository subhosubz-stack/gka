import { defineConfig } from 'vite';
import path from 'path';

const htmlEntries = [
  'index.html',
  'login.html',
  'signup.html',
  'verify-account.html',
  'product-tour.html',
  'role-select.html',
  'discover.html',
  'listing.html',
  'coming-soon.html',
  'support.html',
  'tenant-dashboard.html',
  'tenant-search-dashboard.html',
  'tenant-match.html',
  'tenant-resident-dashboard.html',
  'tenant-chats.html',
  'tenant-wishlist.html',
  'tenant-tiffin.html',
  'owner-dashboard.html',
  'owner-onboarding.html',
  'broker-dashboard.html',
  'broker-onboarding.html',
  'admin-dashboard.html',
  'super-admin/index.html',
  'property-admin/index.html',
  'services/services-dashboard.html',
  'services/services-onboarding.html'
];

export default defineConfig(() => {
  const input = Object.fromEntries(
    htmlEntries.map((file) => {
      const key = file.replace(/[/\\.]/g, '_').replace(/_html$/, '');
      return [key, path.resolve(__dirname, file)];
    })
  );

  return {
    build: {
      rollupOptions: { input }
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.')
      }
    },
    server: {
      port: 3000,
      host: '0.0.0.0',
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {}
    }
  };
});
