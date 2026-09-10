FROM mcr.microsoft.com/playwright:v1.63.0-noble

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm install --omit=optional

COPY tsconfig.json jest.config.js ./
COPY src ./src
COPY scripts ./scripts

RUN npm run build

RUN mkdir -p /app/data/resumes /app/data/browser

CMD ["node", "-e", "require('./dist/api/bootstrap'); require('./dist/index')"]
