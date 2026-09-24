'use strict';
// 애플리케이션 컨텍스트: DB · 설정 · 비밀키 · 어댑터를 한곳에 묶는다.

const crypto = require('node:crypto');
const { Db } = require('./db');
const settings = require('./settings');
const { createNotifier } = require('./adapters/notifier');
const { createPayment } = require('./adapters/payment');

const ENV_SECRET = { link: 'BEVFLOW_LINK_SECRET', ingest: 'BEVFLOW_INGEST_SECRET', webhook: 'BEVFLOW_WEBHOOK_SECRET' };

function createContext({ file = ':memory:', env = process.env } = {}) {
  const db = new Db(file);
  const ctx = { db, env };
  ctx.reload = () => { ctx.settings = settings.load(db); ctx.R = settings.rules(ctx.settings); return ctx.R; };
  ctx.getSecret = (name) => {
    if (env[ENV_SECRET[name]]) return env[ENV_SECRET[name]];
    let r = db.get('SELECT value FROM secrets WHERE key = ?', [name]);
    if (!r) {
      db.run('INSERT INTO secrets (key, value) VALUES (?, ?)', [name, crypto.randomBytes(32).toString('base64url')]);
      r = db.get('SELECT value FROM secrets WHERE key = ?', [name]);
    }
    return r.value;
  };
  ctx.rotateSecret = (name) => {
    db.run('INSERT INTO secrets (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [name, crypto.randomBytes(32).toString('base64url')]);
    if (name === 'link') ctx.secret = ctx.getSecret('link');
  };
  ctx.reload();
  ctx.secret = ctx.getSecret('link');
  ctx.notifier = createNotifier({ getRules: () => ctx.R, getSecret: ctx.getSecret });
  ctx.payment = createPayment({ getRules: () => ctx.R });
  return ctx;
}

module.exports = { createContext };
