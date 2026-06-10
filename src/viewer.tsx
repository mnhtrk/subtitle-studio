import './App.css';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { ViewerWindow } from './components/video/ViewerWindow';

ReactDOM.createRoot(document.getElementById('viewer-root') as HTMLElement).render(
	<React.StrictMode>
		<ViewerWindow />
	</React.StrictMode>
);
