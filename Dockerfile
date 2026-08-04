FROM node:22-alpine AS web-build
WORKDIR /app/web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM node:22-alpine
ENV NODE_ENV=production
# Layout matters: app.js serves ../../web/dist relative to api/src
WORKDIR /app/api
COPY api/package*.json ./
RUN npm ci --omit=dev
COPY api/ ./
COPY --from=web-build /app/web/dist /app/web/dist
VOLUME /app/api/uploads
EXPOSE 3000
CMD ["sh", "-c", "node src/migrate.js && node src/index.js"]
