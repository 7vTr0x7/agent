FROM mcr.microsoft.com/playwright:v1.63.0-noble

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm install --omit=optional

COPY tsconfig.json jest.config.js ./
COPY src ./src

RUN npm run build && npm prune --omit=dev

RUN mkdir -p /app/data/resumes /app/data/browser

CMD ["node", "dist/index.js"]
