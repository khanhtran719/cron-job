import { appendFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

// Function log message to file with timestamp
export function log(message: string) {
  const timestamp = new Date().toISOString();
  const day = new Date().toISOString().split('T')[0];

  const path = join(process.cwd(), 'logs', `app-${day}.log`);

  if (!existsSync(join(process.cwd(), 'logs'))) {
    mkdirSync(join(process.cwd(), 'logs'), { recursive: true });
  }

  appendFileSync(path, `[${timestamp}] ${message}\n`);
}
