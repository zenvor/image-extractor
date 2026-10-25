import { initializeLocale } from '../../lib/i18n';
import { createRoot } from 'react-dom/client';
import App from './App';
import '../../assets/styles.css';

initializeLocale().then(() => createRoot(document.getElementById('app')!).render(<App />));
