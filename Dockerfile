FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

RUN mkdir -p /data && chown node:node /data

USER node

ENV NODE_ENV=production
ENV DB_PATH=/data/restaurant.db
ENV PORT=3000

EXPOSE 3000

CMD ["node", "--experimental-sqlite", "server.js"]
