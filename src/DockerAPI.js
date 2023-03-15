const axios = require('axios');

class DockerAPI {
    async token(username, password) {
        username = username.toLowerCase();
        const path = '/v2/users/login';

        return this.requestToken(path, username, password);
    }

    async repository(user, name, token) {
        user = user.toLowerCase();
        const path = `/v2/repositories/${user}/${name}`;

        return this.request(path, null, null, token);
    }

    async tags(user, name, token) {
        user = user.toLowerCase();
        const path = `/v2/repositories/${user}/${name}/tags`;

        const firstPageResult = await this.request(path, 1, 100, token);

        const totalElementCount = firstPageResult.count;
        const maxPage = Math.ceil(totalElementCount / 100);

        const subsequentResults = [];

        for await (const i of Array(maxPage - 1).keys()) {
            const pageResult = await this.request(path, i + 2, 100, token);
            subsequentResults.push(pageResult);
        }

        subsequentResults.push(firstPageResult);
        const elementArray = subsequentResults.flatMap((result) => result.results);

        return elementArray;
    }

    async request(path, page, pageSize, token) {
        let url = `https://hub.docker.com${path}`;

        if (page && pageSize) {
            url += `?page_size=${pageSize}&page=${page}`;
        }

        try {
            const options = token ? { headers: { Authorization: `Bearer ${token}` } } : {};
            const res = await axios.get(url, options);
            return res.data;
        } catch (error) {
            console.error('Failed to fetch', error);
            return null;
        }
    }

    async requestToken(path, username, password) {
        const url = `https://hub.docker.com${path}`;

        try {
            const res = await axios.post(url, { username, password });
            return res.data.token;
        } catch (error) {
            console.error('Failed to fetch', error);
            return null;
        }
    }
}

module.exports = { DockerAPI: DockerAPI };
