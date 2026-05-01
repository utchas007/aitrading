# WebSocket broadcast server
FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache libc6-compat

COPY package.json package-lock.json ./
RUN npm ci --prefer-offline

COPY lib/     ./lib/
COPY websocket-server.ts ./
COPY tsconfig.json ./

EXPOSE 3002

CMD ["npx", "tsx", "websocket-server.ts"]
