FROM node:alpine AS base

WORKDIR /usr/src/app

FROM base AS build

ENV NODE_ENV=production

COPY ./package.json /usr/src/app/package.json

RUN yarn install --frozen-lockfile

FROM base AS deploy

ENV NODE_ENV=production

COPY . /usr/src/app
COPY --from=build /usr/src/app/package.json /usr/src/app/package.json

CMD ["node", "index.js"]
