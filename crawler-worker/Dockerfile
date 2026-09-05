FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
RUN npm install --include=dev --no-audit --no-fund
COPY . .
RUN npm run typecheck
EXPOSE 3001
CMD ["npm", "start"]
