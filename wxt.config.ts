import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  vite: () => ({ plugins: [tailwindcss()], build: { license: { fileName: 'THIRD_PARTY_LICENSES.md' } } }),
  manifestVersion: 3,
  webExt: { disabled: true },
  manifest: {
    name: 'Image Extractor',
    description: '__MSG_extensionDescription__',
    default_locale: 'en',
    permissions: ['activeTab', 'scripting', 'storage'],
    optional_permissions: ['downloads'],
    optional_host_permissions: ['http://*/*', 'https://*/*'],
    minimum_chrome_version: '120',
    action: { default_title: 'Image Extractor', default_icon: { 16: 'icons/16.png', 32: 'icons/32.png', 48: 'icons/48.png' } },
    icons: { 16: 'icons/16.png', 32: 'icons/32.png', 48: 'icons/48.png', 128: 'icons/128.png' },
  },
});
