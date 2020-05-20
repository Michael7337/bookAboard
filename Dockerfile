FROM gcr.io/city-7337/base
ARG BUILD_NUM
ENV BUILD_NUM=$BUILD_NUM

ADD package.json package.json
ADD serve.js serve.js
ADD static static

#shut up npm
run npm config set loglevel warn
RUN npm i

EXPOSE 8080

CMD ["npm", "start"]