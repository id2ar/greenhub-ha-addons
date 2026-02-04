ARG BUILD_FROM
FROM $BUILD_FROM

RUN apk add --no-cache nodejs npm

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --only=production || npm install --only=production

COPY src ./src
COPY run.sh /run.sh
RUN chmod +x /run.sh

CMD ["/run.sh"]

