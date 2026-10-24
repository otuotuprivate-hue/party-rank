FROM node:22-alpine
WORKDIR /app
COPY package.json server.js set-admin.js ./
COPY public ./public
ENV DATA_DIR=/data TRUST_PROXY=1
VOLUME /data
EXPOSE 3000
CMD ["node", "server.js"]
