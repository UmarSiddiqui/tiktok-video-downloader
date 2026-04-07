FROM node:20-slim

ENV NODE_ENV=production

# Install ffmpeg and fetch yt-dlp binary
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl ffmpeg \
  && rm -rf /var/lib/apt/lists/* \
  && curl -L "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp" -o /usr/local/bin/yt-dlp \
  && chmod +x /usr/local/bin/yt-dlp

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY public ./public
COPY server.js ./server.js

# tmp dir is created at runtime if missing

EXPOSE 3000

CMD ["node", "server.js"]
