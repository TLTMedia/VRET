import './style.css';
import { App } from './App';

document.addEventListener('DOMContentLoaded', () => {
	const app = new App();
	(window as any).app = app;
	app.init();
});
