FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update \
  && apt-get install -y --no-install-recommends procps ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY package.json ./
RUN npm install --include=dev --no-audit --no-fund
COPY . .
RUN npm run build
EXPOSE 3001
CMD ["npm", "start"]
