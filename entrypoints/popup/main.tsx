import { initializeLocale } from '../../lib/i18n';
import { createRoot } from 'react-dom/client';
import App from './App';
import { loadPopupSnapshot, preview } from './bootstrap';
import { PopupSkeleton } from './PopupSkeleton';
import '../../assets/styles.css';

async function start() {
  const root = createRoot(document.getElementById('app')!);
  const localeReady = initializeLocale();
  root.render(<PopupSkeleton preview={preview} />);
  const [, snapshot] = await Promise.all([localeReady, loadPopupSnapshot()]);
  root.render(<App initialSnapshot={snapshot} />);
}
void start();
