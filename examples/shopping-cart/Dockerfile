# ============================================
# Stage 1: Build e Pack do Pacote Principal
# ============================================
FROM node:20-alpine AS builder-main-package

WORKDIR /root-package

# Copiar arquivos necessários para build
COPY package*.json tsup.config.ts tsconfig*.json ./
COPY src ./src

# Instalar deps e buildar
RUN npm ci --include=dev && npm run build

# Criar tarball do pacote
RUN npm pack

# ============================================
# Stage 2: Build Shopping Cart
# ============================================
FROM node:20-alpine AS builder-app

WORKDIR /app

# Copiar package.json do shopping-cart
COPY examples/shopping-cart/package.json ./

# Copiar tarball do stage anterior
COPY --from=builder-main-package /root-package/*.tgz /tmp/

# Instalar todas as dependências incluindo o tarball
# Primeiro instala do package.json, depois adiciona o tarball
# Adiciona yaml explicitamente (peer dep do emmett-expressjs-with-openapi)
RUN npm install && npm install /tmp/*.tgz && npm install yaml

# Copiar código fonte
COPY examples/shopping-cart/src ./src
COPY examples/shopping-cart/openapi.yml ./openapi.yml

# ============================================
# Stage 3: Production Runtime
# ============================================
FROM node:20-alpine AS production

WORKDIR /app

# Copiar node_modules e código
COPY --from=builder-app /app/node_modules ./node_modules
COPY --from=builder-app /app/src ./src
COPY --from=builder-app /app/openapi.yml ./openapi.yml
COPY --from=builder-app /app/package.json ./package.json

EXPOSE 3000
ENV NODE_ENV=production

# Rodar com tsx
CMD ["npx", "tsx", "src/index.ts"]
