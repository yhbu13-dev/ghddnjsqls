'use strict';
// HTTP 서버 조립: 세션 확인 → CSRF 헤더 확인 → 권한 확인 → 핸들러 → 응답

const http = require('node:http');
const path = require('node:path');
const auth = require('./auth');
const { buildRoutes } = require('./routes');
const { HttpError, parseCookies, send, serveFile } = require('./http');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

function createServer(ctx, { trustProxy = false, log = console } = {}) {
  const router = buildRoutes(ctx);

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://local');
    req.ip = (trustProxy && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || '';
    req.secure = trustProxy ? req.headers['x-forwarded-proto'] === 'https' : !!req.socket.encrypted;
    const cookies = parseCookies(req);
    req.sid = cookies.bf_sid || null;
    req.user = auth.sessionUser(ctx.db, req.sid);

    try {
      if (url.pathname.startsWith('/api/') || url.pathname === '/healthz') {
        const m = router.match(req.method, url.pathname);
        if (!m) throw new HttpError(404, '없는 API입니다');
        if (m.notAllowed) throw new HttpError(405, '허용되지 않는 메서드입니다');
        const { route, params } = m;
        // CSRF: 상태를 바꾸는 요청은 사용자 정의 헤더가 있어야 한다 (외부 사이트 폼으로는 붙일 수 없음)
        if (!['GET', 'HEAD'].includes(req.method) && !route.opts.noCsrf && req.headers['x-bevflow'] !== '1') throw new HttpError(403, '요청 헤더가 올바르지 않습니다');
        if (!route.opts.public) auth.requireRole(req.user, route.opts.role || 'admin');
        if (req.user && req.user.must_change && !['/api/auth/password', '/api/me', '/api/auth/logout'].includes(url.pathname)) throw new HttpError(403, '비밀번호를 먼저 변경해 주세요');
        // 스냅샷 ETag: DB 쓰기 버전 기준 (변경이 없으면 304로 전송량 절약)
        if (route.opts.etag) {
          const tag = `W/"v${ctx.db.version}-u${req.user ? req.user.id : 0}"`;
          if (req.headers['if-none-match'] === tag) { res.writeHead(304, { ETag: tag }); return res.end(); }
          req.etag = tag;
        }
        const out = await route.handler(req, params, url);
        const headers = {};
        if (req.setCookie) headers['Set-Cookie'] = req.setCookie;
        if (out && out.__raw != null) {
          headers['Content-Type'] = out.type;
          headers['Content-Disposition'] = `attachment; filename="${out.filename}"`;
          return send(res, 200, out.__raw, headers);
        }
        if (req.etag) headers.ETag = req.etag;
        return send(res, 200, out, headers);
      }

      if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, '허용되지 않는 메서드입니다');
      // 페이지 라우팅
      let page = null;
      if (url.pathname === '/') {
        if (!req.user) { res.writeHead(302, { Location: '/login' }); return res.end(); }
        page = 'console.html';
      } else if (url.pathname === '/login') page = 'login.html';
      else if (/^\/o\/[A-Za-z0-9_\-.]+$/.test(url.pathname)) page = 'owner.html';
      else if (/^\/d\/[A-Za-z0-9_\-.]+$/.test(url.pathname)) page = 'driver.html';
      else if (/^\/assets\/[a-z0-9_.-]+$/i.test(url.pathname)) page = url.pathname.slice(1);
      if (page && serveFile(res, PUBLIC_DIR, page)) return;
      throw new HttpError(404, '페이지를 찾을 수 없습니다');
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status >= 500) log.error('[HTTP]', req.method, url.pathname, e);
      if (!res.headersSent) send(res, status, { error: status >= 500 ? '서버 오류가 발생했습니다' : e.message });
      else res.end();
    }
  });
}

module.exports = { createServer };
