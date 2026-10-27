import { initializeLocale } from '../../lib/i18n';
import { createRoot } from 'react-dom/client';
import App from './App';
import { loadPopupSnapshot } from './bootstrap';
import '../../assets/styles.css';

async function start() {
  const [, snapshot] = await Promise.all([initializeLocale(), loadPopupSnapshot()]);
  createRoot(document.getElementById('app')!).render(<App initialSnapshot={snapshot} />);
}
void start();
