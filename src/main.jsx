import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { LoginProvider } from './login/LoginProvider';
import './index.css';
import AppRoutes from './AppRoutes.jsx';
createRoot(document.getElementById('root')).render(<StrictMode><BrowserRouter><LoginProvider><AppRoutes /></LoginProvider></BrowserRouter></StrictMode>);
