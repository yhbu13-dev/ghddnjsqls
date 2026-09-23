# 저장소 루트에서 빌드:  docker build -f deploy/Dockerfile -t bevflow .
# 실행:  docker run -d --name bevflow -p 127.0.0.1:8080:8080 -v bevflow-data:/app/data bevflow
#        docker logs bevflow     # 첫 실행 때 관리자 임시 비밀번호
FROM node:22-slim

ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0 \
    BEVFLOW_DB=/app/data/bevflow.db \
    BEVFLOW_TRUST_PROXY=1 \
    TZ=Asia/Seoul

WORKDIR /app
COPY package.json ./
COPY server ./server
COPY public ./public
COPY scripts ./scripts

RUN mkdir -p /app/data /app/backups && chown -R node:node /app/data /app/backups
USER node
VOLUME ["/app/data", "/app/backups"]
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.js"]
