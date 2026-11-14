#!/usr/bin/env node
import { runCli } from './cli.js';
import { toAppError } from './core/errors.js';

process.on('unhandledRejection', (reason) => {
  const app = toAppError(reason);
  console.error(JSON.stringify({ ok: false, error: { code: app.code, message: app.message } }));
  process.exit(5);
});

runCli(process.argv).catch((err) => {
  const app = toAppError(err);
  console.error(JSON.stringify({ ok: false, error: { code: app.code, message: app.message } }));
  process.exit(5);
});
