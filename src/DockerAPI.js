const axios = require('axios');

class DockerAPI {
  token(username, password) {
    username = username.toLowerCase();

    const path = '/v2/users/login';

    return this.requestToken(path, username, password);
  }

  repository(user, name, token) {
    user = user.toLowerCase();

    const path = `/v2/repositories/${user}/${name}`;

    return this.request(path, null, null, token);
  }

  tags(user, name, token) {
    user = user.toLowerCase();

    const path = `/v2/repositories/${user}/${name}/tags`;

    return this.requestAllPages(path, token);
  }

  requestAllPages(path, token) {
    const pageSize = 100;

    return new Promise((resolve, reject) => {
      this.request(path, 1, pageSize, token)
          .then((firstPageResult) => {
            const totalElementCount = firstPageResult.count;
            const maxPage = Math.ceil(totalElementCount / pageSize);

            const promises = [];

            for (let i = 2; i <= maxPage; i++) {
              promises.push(this.request(path, i, pageSize, token));
            }

            Promise.all(promises)
                .then((subsequentResults) => {
                  subsequentResults.push(firstPageResult);
                  // Extract the results from each of the requests
                  const elementArray =
                      subsequentResults.flatMap((result) => result.results);

                  resolve(elementArray);
                })
                .catch((error) => { reject(error); });
          })
          .catch((error) => { reject(error); });
    });
  }

  request(path, page, pageSize, token) {
    let url = `https://hub.docker.com${path}`;

    if (page && pageSize) {
      url += `?page_size=${pageSize}&page=${page}`;
    }

    return token ? axios({
                     method : 'GET',
                     url,
                     headers : {
                       Authorization : `Bearer ${token}`,
                     },
                   }).then((res) => res.data)
                 : axios({
                     method : 'GET',
                     url,
                   }).then((res) => res.data);
  }

  requestToken(path, username, password) {
    const url = `https://hub.docker.com${path}`;

    return axios({
             method : 'POST',
             url,
             data : {
               username,
               password,
             },
           })
        .then((res) => res.data.token);
  }
}

module.exports = {
  DockerAPI : DockerAPI
};
