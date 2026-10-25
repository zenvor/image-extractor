import { initializeLocale } from '../../lib/i18n';
import React from 'react';
import ReactDOM from 'react-dom/client';
import '../../assets/styles.css';
import { Tools } from './tools';
initializeLocale().then(() => ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><Tools /></React.StrictMode>));
