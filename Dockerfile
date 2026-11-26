FROM node:22-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY market-registry.json ./market-registry.json
COPY src ./src
COPY scripts/cloud-services.mjs ./scripts/cloud-services.mjs

ENV NODE_ENV=production

CMD ["npm", "run", "cloud"]
