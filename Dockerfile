FROM mcr.microsoft.com/playwright:v1.63.0-noble

# Contact-resource ingestion supports PDF, legacy Word, and legacy Excel locally/in CI.
RUN apt-get update \
  && apt-get install -y --no-install-recommends poppler-utils antiword catdoc python3-xlrd \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm install --omit=optional --include=dev

ENV NODE_ENV=production

COPY tsconfig.json jest.config.js ./
COPY src ./src
COPY scripts ./scripts

RUN npm run build

# Fail the image build if compiled runtime code is stale relative to the recruiter JSONB fix.
RUN grep -Fq 'JSON.stringify(relevanceEvidence)' /app/dist/recruiters/ProactiveRecruiterRepository.js

RUN mkdir -p /app/data/resumes /app/data/browser

CMD ["node", "-e", "require('./dist/api/bootstrap'); require('./dist/index')"]
