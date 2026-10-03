FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server.js ./
COPY lib ./lib
COPY public ./public
COPY catalog ./catalog
ENV PORT=7200 CONFIG_DIR=/config BACKUP_DIR=/backups
EXPOSE 7200
HEALTHCHECK --interval=60s --timeout=5s CMD wget -qO- http://127.0.0.1:7200/api/info >/dev/null || exit 1
CMD ["node", "server.js"]
