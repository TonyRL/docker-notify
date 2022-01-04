# base
FROM node:alpine AS base
WORKDIR /usr/src/app

# build
FROM base AS build
ENV NODE_ENV=production

COPY ./package.json /usr/src/app/package.json
RUN yarn install --frozen-lockfile

# deploy
FROM base AS deploy
ENV NODE_ENV=production

COPY ./src /usr/src/app/src
COPY --from=build /usr/src/app/package.json /usr/src/app/package.json
COPY --from=build /usr/src/app/node_modules /usr/src/app/node_modules

CMD ["node", "src/index.js"]
