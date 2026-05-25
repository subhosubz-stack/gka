import dotenv from 'dotenv';
import path from 'path';
import { createApp } from '../src/createApp.js';

dotenv.config({ path: path.join(process.cwd(), '.env') });

const app = await createApp({ enableVite: false });

export default app;
