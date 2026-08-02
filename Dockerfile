# ---------- deps: compila/instala solo dependencias de producción ----------
FROM node:24-slim AS deps
WORKDIR /app/server
# better-sqlite3 trae prebuilds para node24/linux-x64; las herramientas de
# compilación son red de seguridad si el prebuild no estuviera disponible.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev

# ---------- runtime ----------
FROM node:24-slim
ENV NODE_ENV=production \
    # Nombres REALES de server/src/config.js:
    PORT=3000 \
    DATA_DIR=/app/data \
    # STATIC_DIR por defecto ya resuelve a /app/app/dist (relativo a config.js);
    # se declara explícito por claridad.
    STATIC_DIR=/app/app/dist \
    # Bootstrap del primer admin (solo primer arranque). Si AUTH_PASS falta,
    # NO se crea admin (ver server/src/auth.js ensureBootstrapAdmin).
    # ¡Cámbialos en el entorno del contenedor!
    AUTH_USER=admin \
    AUTH_PASS=cambiar-1234 \
    # 'true' solo detrás de HTTPS (reverse proxy con TLS)
    COOKIE_SECURE=false \
    MAX_SSE_CLIENTS=20 \
    MAX_UPLOAD_MB=10

WORKDIR /app
COPY --from=deps /app/server/node_modules server/node_modules
COPY server/ server/
COPY app/dist app/dist

# Datos (SQLite + uploads) fuera del código; el server los crea si faltan
RUN mkdir -p /app/data && chown -R node:node /app
USER node

EXPOSE 3000
# Sin .env: el server arranca con defaults + variables de entorno
CMD ["node", "server/src/index.js"]
