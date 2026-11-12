FROM node:24-alpine
# Non-root: /app and the uploads mount must belong to `node` before USER switches.
RUN mkdir -p /app /data/uploads && chown node:node /app /data/uploads
USER node
WORKDIR /app
COPY --chown=node:node package*.json ./
RUN npm ci
COPY --chown=node:node . .
RUN DATABASE_URL=postgresql://x@localhost/x npm run build
EXPOSE 3100
# migrate deploy only: never `migrate reset` or seed on start.
CMD ["sh", "-c", "npx prisma migrate deploy && npm start"]
