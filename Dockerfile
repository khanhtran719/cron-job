FROM node:20-alpine AS base

WORKDIR /app

RUN apk add --no-cache libc6-compat

FROM base AS deps

COPY package.json package-lock.json ./

RUN npm ci --omit=dev

FROM base AS builder

COPY package.json package-lock.json ./

RUN npm ci

COPY . .

RUN npm run build

FROM base AS runner

ENV TZ='Asia/Ho_Chi_Minh'

COPY --from=builder /app/dist ./dist
COPY --from=deps /app/node_modules ./node_modules

CMD ["node", "dist/index.js"]
