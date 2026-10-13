#Funca productive
FROM node:20-alpine
USER node
RUN mkdir -p /home/node/app
WORKDIR /home/node
COPY --chown=node . .
#WORKDIR /app
#COPY . .
RUN npm install
RUN npm run build
CMD ["npm", "run", "start:prod"]
RUN chmod -R 777 /home/node/pdfs
#CMD ["yarn", "start:dev"]
