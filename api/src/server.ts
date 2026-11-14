import 'dotenv/config';
import { createApp } from './http/app.js';

const port = Number(process.env.API_PORT ?? 3000);
createApp().listen(port, '0.0.0.0', () => console.log(`API listening on ${port}`));
