import dotenv from 'dotenv';
import path from 'path';
import { createApp } from './src/createApp.js';

dotenv.config({ path: path.join(process.cwd(), '.env') });

const PORT = process.env.PORT || 3000;
const isDev = process.env.NODE_ENV !== 'production';

const app = await createApp({ enableVite: isDev });

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🏡 GharKaAdda running at http://127.0.0.1:${PORT}`);
  console.log(`   API: http://127.0.0.1:${PORT}/api/health`);
});
