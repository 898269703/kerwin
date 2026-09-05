FROM node:22-bookworm-slim
WORKDIR /app
COPY bundle.tar.gz.b64 /tmp/bundle.tar.gz.b64
RUN base64 -d /tmp/bundle.tar.gz.b64 | tar -xz -C /app && rm /tmp/bundle.tar.gz.b64
ENV NODE_ENV=production
RUN npm install --include=dev --no-audit --no-fund
RUN npm run build
EXPOSE 3001
CMD ["npm","start"]
